require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '8017590244');
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

let BOT_USERNAME = '';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN חסר!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const DB_FILE = path.join(__dirname, 'movies_db.json');

// ==========================================
// 🎨 מיתוג ועיצוב הודעות
// ==========================================
const BRAND_CAPTION = (title) => 
  `🎬 <b>${title}</b>\n` +
  `━━━━━━━━━━━━━━━━━━━━━━\n` +
  `🍿 <b>MOVIE TIME VIP</b>\n` +
  `✨ צפייה מהנה!\n\n` +
  `🔗 <a href="https://t.me/movie_time_by">להצטרפות לערוץ הרשמי שלנו</a>`;

// ==========================================
// 🧠 מנוע חיפוש - התאמת מילים שלמות בלבד
// ==========================================
function normalizeText(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/["'״׳\-_\.\,\:\;\!\?\(\)\[\]]/g, ' ')
    .replace(/[ם]/g, 'מ')
    .replace(/[ן]/g, 'נ')
    .replace(/[ץ]/g, 'צ')
    .replace(/[ף]/g, 'פ')
    .replace(/[ך]/g, 'כ')
    .replace(/\s+/g, ' ')
    .trim();
}

function smartSearch(query, items) {
  const cleanQuery = normalizeText(query);
  if (!cleanQuery) return [];

  const queryWords = cleanQuery.split(' ').filter(w => w.length > 1);
  if (queryWords.length === 0) return [];

  const scored = items.map(item => {
    let maxScore = 0;
    const aliases = item.aliases || [item.title || item.name];

    for (const alias of aliases) {
      const cleanAlias = normalizeText(alias);
      if (!cleanAlias) continue;

      if (cleanAlias === cleanQuery) {
        maxScore = Math.max(maxScore, 100);
        continue;
      }

      const aliasWords = cleanAlias.split(' ').filter(w => w.length > 1);
      let exactWordMatches = 0;

      for (const qw of queryWords) {
        if (aliasWords.includes(qw)) {
          exactWordMatches++;
        }
      }

      if (exactWordMatches > 0) {
        const ratio = exactWordMatches / queryWords.length;
        const score = 50 + (ratio * 40);
        maxScore = Math.max(maxScore, score);
      }
    }

    return { item, score: maxScore };
  });

  return scored
    .filter(res => res.score >= 50)
    .sort((a, b) => b.score - a.score)
    .map(res => res.item);
}

function autoDeleteMessage(ctx, chatId, messageId, delayMs = 12000) {
  setTimeout(async () => {
    try {
      await ctx.telegram.deleteMessage(chatId, messageId);
    } catch (e) {}
  }, delayMs);
}

// ==========================================
// 💾 מנגנון מאגר נתונים + גיבוי ענן אוטומטי
// ==========================================
function loadLocalDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        movies: parsed.movies || [],
        channels: parsed.channels || [],
        pendingRequests: parsed.pendingRequests || []
      };
    }
  } catch (e) {
    console.error('⚠️ שגיאה בקריאת מאגר מקומי:', e.message);
  }
  return { movies: [], channels: [], pendingRequests: [] };
}

let db = loadLocalDb();

async function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    
    const doc = await bot.telegram.sendDocument(ADMIN_ID, {
      source: DB_FILE,
      filename: 'movies_db.json'
    }, { 
      caption: `🔄 <b>גיבוי מאגר אוטומטי מעודכן</b>\n` +
               `🎬 סרטים/פרקים: <code>${data.movies.length}</code>\n` +
               `📢 ערוצים/קבוצות: <code>${data.channels.length}</code>\n` +
               `📋 בקשות ממתינות: <code>${data.pendingRequests.length}</code>`, 
      parse_mode: 'HTML' 
    }).catch(err => console.error('⚠️ לא ניתן לשלוח גיבוי לטלגרם:', err.message));

    if (doc?.message_id) {
      await bot.telegram.pinChatMessage(ADMIN_ID, doc.message_id, { disable_notification: true }).catch(() => {});
    }
  } catch (e) {
    console.error('❌ שגיאה בשמירת המאגר:', e.message);
  }
}

async function autoRestoreFromTelegram() {
  if ((db.movies && db.movies.length > 0) || (db.channels && db.channels.length > 0)) return;

  console.log('🔍 מנסה לשחזר מאגר מנעיצה בטלגרם...');
  try {
    const chat = await bot.telegram.getChat(ADMIN_ID);
    if (chat?.pinned_message?.document?.file_name === 'movies_db.json') {
      const fileId = chat.pinned_message.document.file_id;
      const fileLink = await bot.telegram.getFileLink(fileId);
      
      https.get(fileLink, (res) => {
        let rawData = '';
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
          try {
            const restored = JSON.parse(rawData);
            if (restored) {
              db = {
                movies: restored.movies || [],
                channels: restored.channels || [],
                pendingRequests: restored.pendingRequests || []
              };
              fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
              console.log(`✅ שוחזרו בהצלחה ${db.movies.length} סרטים ו-${db.channels.length} ערוצים!`);
            }
          } catch (err) {}
        });
      });
    }
  } catch (e) {
    console.log('ℹ️ לא נמצא גיבוי נעוץ לשחזור.');
  }
}

// ==========================================
// 🛡️ MIDDLEWARES & KEYBOARDS
// ==========================================
bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  return next();
});

const isAdmin = (ctx) => String(ctx.from?.id) === ADMIN_ID;

const getMainKeyboard = () => {
  const reqCount = db.pendingRequests ? db.pendingRequests.length : 0;
  const chanCount = db.channels ? db.channels.length : 0;
  return Markup.keyboard([
    ['➕ הוספת סרט', '📺 הוספת סדרה'],
    ['📢 הוספת ערוץ/סדרה', `📋 בקשות ממתינות (${reqCount})`],
    ['🗃️ מאגר סרטים', `📢 ערוצים שמורים (${chanCount})`],
    ['🔄 שחזור ידני מגיבוי']
  ]).resize();
};

// ==========================================
// 🚀 START & DEEP LINKS
// ==========================================
bot.start(async (ctx) => {
  const payload = ctx.startPayload;

  if (payload && payload.startsWith('sendall_')) {
    const searchKey = payload.replace('sendall_', '');
    const matches = global.searchCache?.get(searchKey);

    if (matches && matches.length > 0) {
      await ctx.reply(`🍿 <b>שולח אליך את כל ${matches.length} הפרקים שנמצאו:</b>`, { parse_mode: 'HTML' });
      for (const movie of matches) {
        try {
          await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id, {
            caption: BRAND_CAPTION(movie.title),
            parse_mode: 'HTML'
          });
        } catch (err) {}
      }
      return ctx.reply(`✅ <b>כל הפרקים נשלחו בהצלחה! צפייה מהנה!</b> 🍿`, { parse_mode: 'HTML' });
    } else {
      return ctx.reply('⚠️ פג תוקף החיפוש. אנא בצע חיפוש חדש בקבוצה.');
    }
  }

  if (isAdmin(ctx)) {
    ctx.session = {};
    return ctx.reply(
      `🍿 <b>MOVIE TIME VIP | BOT ADMIN</b> 🍿\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ הבוט פעיל ומוכן לעבודה!`,
      { parse_mode: 'HTML', ...getMainKeyboard() }
    );
  } else {
    return ctx.reply(
      `🍿 <b>ברוכים הבאים ל-MOVIE TIME VIP!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `כדי לחפש סרטים, סדרות וערוצים, פשוט הקלד את השם בקבוצה שלנו!`,
      { parse_mode: 'HTML' }
    );
  }
});

// ==========================================
// 📢 ניהול ערוצים / קבוצות שמורות
// ==========================================
bot.hears('📢 הוספת ערוץ/סדרה', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  ctx.session.step = 'WAIT_CHANNEL_LINK';
  return ctx.reply(
    `🔗 <b>שלב 1 מתוך 2: הוספת ערוץ/קבוצה מומלצת</b>\n\n` +
    `שלח כעת את קישור הקישור הציבורי או הפרטי של הערוץ/הקבוצה:\n` +
    `<i>(למשל: https://t.me/example_channel)</i>`,
    { parse_mode: 'HTML', ...Markup.keyboard([['❌ ביטול']]).resize() }
  );
});

bot.hears(/^📢 ערוצים שמורים/, (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  const channels = db.channels || [];
  if (channels.length === 0) {
    return ctx.reply('📢 אין ערוצים או קבוצות שמורות במאגר.', getMainKeyboard());
  }

  ctx.reply(`📢 <b>רשימת ערוצים/קבוצות שמורות (${channels.length}):</b>`, { parse_mode: 'HTML' });
  channels.forEach((c) => {
    ctx.reply(
      `📌 <b>שם:</b> ${c.title}\n` +
      `🔗 <b>קישור:</b> ${c.link}\n` +
      `🔍 <b>מילות מפתח:</b> <code>${c.aliases.join(', ')}</code>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🗑️ מחק ערוץ', `del_chan_${c.id}`)]])
      }
    );
  });
});

bot.action(/^del_chan_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const chanId = ctx.match[1];
  db.channels = (db.channels || []).filter(c => c.id !== chanId);
  await saveDb(db);
  ctx.answerCbQuery('🗑️ הערוץ נמחק!');
  return ctx.editMessageText('❌ <i>הערוץ הוסר מהמאגר.</i>', { parse_mode: 'HTML' });
});

// ==========================================
// 📋 ניהול בקשות ממתינות להוספה
// ==========================================
bot.hears(/^📋 בקשות ממתינות/, (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  const reqs = db.pendingRequests || [];
  if (reqs.length === 0) {
    return ctx.reply('✨ אין בקשות ממתינות להוספה כרגע!', getMainKeyboard());
  }

  ctx.reply(`📋 <b>רשימת בקשות ממתינות (${reqs.length}):</b>`, { parse_mode: 'HTML' });

  reqs.forEach((req) => {
    const userStr = `${req.user.name} ${req.user.username ? `(${req.user.username})` : ''}`;
    ctx.reply(
      `🔍 <b>חיפוש:</b> <code>${req.query}</code>\n` +
      `👤 <b>מבקש:</b> ${userStr}\n` +
      `📅 <b>תאריך:</b> ${req.date}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('➕ הוסף כסרט', `qadd_mov_${req.id}`),
            Markup.button.callback('📺 הוסף כסדרה', `qadd_ser_${req.id}`)
          ],
          [Markup.button.callback('❌ מחק בקשה', `del_req_${req.id}`)]
        ])
      }
    );
  });
});

bot.action(/^del_req_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const reqId = ctx.match[1];
  db.pendingRequests = (db.pendingRequests || []).filter(r => r.id !== reqId);
  await saveDb(db);
  ctx.answerCbQuery('🗑️ הבקשה נמחקה!');
  return ctx.editMessageText('❌ <i>הבקשה הוסרה מהרשימה.</i>', { parse_mode: 'HTML' });
});

bot.action(/^qadd_mov_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  const reqId = ctx.match[1];
  const req = (db.pendingRequests || []).find(r => r.id === reqId);

  if (!req) return ctx.answerCbQuery('❌ הבקשה לא נמצאה.', { show_alert: true });

  ctx.session.step = 'WAIT_FILE';
  ctx.session.presetTitle = req.query;
  ctx.session.pendingReqId = req.id;

  ctx.answerCbQuery();
  return ctx.reply(
    `📥 <b>הוספת סרט מהירה עבור:</b> "<code>${req.query}</code>"\n\n` +
    `שלח או העבר (Forward) אליי כעת את קובץ הסרט:`,
    { parse_mode: 'HTML', ...Markup.keyboard([['❌ ביטול']]).resize() }
  );
});

bot.action(/^qadd_ser_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  const reqId = ctx.match[1];
  const req = (db.pendingRequests || []).find(r => r.id === reqId);

  if (!req) return ctx.answerCbQuery('❌ הבקשה לא נמצאה.', { show_alert: true });

  ctx.session.step = 'WAIT_SERIES_FILES';
  ctx.session.seriesQueue = [];
  ctx.session.presetTitle = req.query;
  ctx.session.pendingReqId = req.id;

  ctx.answerCbQuery();
  return ctx.reply(
    `📺 <b>הוספת סדרה מהירה עבור:</b> "<code>${req.query}</code>"\n\n` +
    `1️⃣ העבר או שלח את קובצי הפרקים <b>לפי הסדר</b>.\n` +
    `2️⃣ בסיום לחץ על <b>'✅ סיימתי להעלות פרקים'</b>.`,
    { parse_mode: 'HTML', ...Markup.keyboard([['✅ סיימתי להעלות פרקים'], ['❌ ביטול']]).resize() }
  );
});

// ==========================================
// 👑 פאנל ניהול אדמין - הוספת סרטים וסדרות
// ==========================================
bot.hears('➕ הוספת סרט', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  ctx.session.step = 'WAIT_FILE';
  return ctx.reply(
    `📥 <b>שלב 1 מתוך 2:</b>\nשלח או העבר (Forward) אליי כעת את קובץ הסרט.`,
    { parse_mode: 'HTML', ...Markup.keyboard([['❌ ביטול']]).resize() }
  );
});

bot.hears('📺 הוספת סדרה', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  ctx.session.step = 'WAIT_SERIES_FILES';
  ctx.session.seriesQueue = [];
  return ctx.reply(
    `📺 <b>הוספת סדרה במהירות:</b>\n\n` +
    `1️⃣ העבר או שלח אליי את קובצי הפרקים <b>לפי הסדר</b>.\n` +
    `2️⃣ בסיום לחץ על <b>'✅ סיימתי להעלות פרקים'</b>.`,
    { parse_mode: 'HTML', ...Markup.keyboard([['✅ סיימתי להעלות פרקים'], ['❌ ביטול']]).resize() }
  );
});

bot.hears('✅ סיימתי להעלות פרקים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  if (ctx.session.step !== 'WAIT_SERIES_FILES' || !ctx.session.seriesQueue || ctx.session.seriesQueue.length === 0) {
    return ctx.reply('⚠️ לא נקלטו קבצים עדיין.');
  }

  const count = ctx.session.seriesQueue.length;
  ctx.session.step = 'WAIT_SERIES_NAME';

  const defaultTitleMsg = ctx.session.presetTitle 
    ? `\n<i>💡 לחץ או שלח בלחיצה: <code>${ctx.session.presetTitle}</code></i>`
    : '';

  return ctx.reply(
    `🎉 <b>נקלטו ${count} פרקים!</b>\n\n` +
    `✍ <b>שלב אחרון:</b> שלח כעת את שם הסדרה והעונה (למשל: <code>סדרה עונה 1</code>).${defaultTitleMsg}`,
    { parse_mode: 'HTML', ...Markup.keyboard([['❌ ביטול']]).resize() }
  );
});

bot.hears('❌ ביטול', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session = {};
  return ctx.reply('הפעולה בוטלה.', getMainKeyboard());
});

bot.hears('🗃️ מאגר סרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  
  if (db.movies.length === 0) {
    return ctx.reply('🗃 המאגר ריק כרגע.');
  }

  ctx.reply(`📦 <b>סה"כ סרטים/סדרות במאגר:</b> <code>${db.movies.length}</code>`, { parse_mode: 'HTML' });
  db.movies.forEach((m, idx) => {
    ctx.reply(
      `<b>${idx + 1}. ${m.title}</b>\n🔍 מילות חיפוש: <code>${m.aliases.join(', ')}</code>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('🗑️ מחק', `del_${m.id}`)]])
      }
    );
  });
});

bot.action(/^del_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const movieId = ctx.match[1];
  db.movies = db.movies.filter(m => m.id !== movieId);
  await saveDb(db);
  ctx.answerCbQuery('🗑️ הסרט נמחק!');
  return ctx.editMessageText('❌ <i>הסרט נמחק מהמאגר.</i>', { parse_mode: 'HTML' });
});

bot.hears('🔄 שחזור ידני מגיבוי', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session.step = 'WAIT_BACKUP';
  return ctx.reply('📥 שלח כעת את קובץ ה-<code>movies_db.json</code> לשחזור:', { parse_mode: 'HTML' });
});

// ==========================================
// 📥 קליטת נתונים בצ'אט פרטי
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  if (!isAdmin(ctx)) return;

  const step = ctx.session.step;

  if (step === 'WAIT_CHANNEL_LINK' && ctx.message.text) {
    const link = ctx.message.text.trim();
    if (link === '❌ ביטול') return next();

    ctx.session.tempChannel = { link };
    ctx.session.step = 'WAIT_CHANNEL_INFO';

    return ctx.reply(
      `✍️ <b>שלב 2 מתוך 2:</b>\n` +
      `שלח כעת את **שם הערוץ/הסדרה ומילות החיפוש** (מופרדות בפסיקים).\n\n` +
      `<i>דוגמה: <code>ריק ומורטי, Rick and Morty, ריק ומורטי ערוץ רשמי</code></i>`,
      { parse_mode: 'HTML' }
    );
  }

  if (step === 'WAIT_CHANNEL_INFO' && ctx.message.text) {
    const input = ctx.message.text.trim();
    if (input === '❌ ביטול') return next();

    const aliases = input.split(/,|,\s*|\n/).map(s => s.trim()).filter(Boolean);
    const mainTitle = aliases[0] || 'ערוץ ללא שם';

    if (!db.channels) db.channels = [];
    db.channels.push({
      id: 'chan_' + Date.now(),
      title: mainTitle,
      link: ctx.session.tempChannel.link,
      aliases: aliases
    });

    await saveDb(db);
    ctx.session = {};

    return ctx.reply(
      `🎉 <b>הערוץ/הקבוצה נשמרו בהצלחה במאגר!</b>\n\n` +
      `📢 <b>שם:</b> ${mainTitle}\n` +
      `🔗 <b>קישור:</b> ${ctx.session.tempChannel.link}\n` +
      `🔍 <b>מילות מפתח:</b> <code>${aliases.join(', ')}</code>`,
      { parse_mode: 'HTML', ...getMainKeyboard() }
    );
  }

  if (step === 'WAIT_SERIES_FILES') {
    const isMedia = ctx.message.video || ctx.message.document || ctx.message.animation;
    if (isMedia) {
      if (!ctx.session.seriesQueue) ctx.session.seriesQueue = [];
      ctx.session.seriesQueue.push({
        from_chat_id: ctx.chat.id,
        message_id: ctx.message.message_id
      });

      const count = ctx.session.seriesQueue.length;
      return ctx.reply(`📥 <b>פרק #${count} נקלט בתור!</b>`, { parse_mode: 'HTML' });
    }
  }

  if (step === 'WAIT_SERIES_NAME' && ctx.message.text) {
    const rawInput = ctx.message.text.trim();
    if (rawInput === '✅ סיימתי להעלות פרקים' || rawInput === '❌ ביטול') return next();

    let seriesTitle = rawInput;
    let startEp = 1;

    if (rawInput.includes('|')) {
      const parts = rawInput.split('|');
      seriesTitle = parts[0].trim();
      const parsedEp = parseInt(parts[1].trim());
      if (!isNaN(parsedEp)) startEp = parsedEp;
    }

    const queue = ctx.session.seriesQueue || [];
    if (queue.length === 0) {
      ctx.session = {};
      return ctx.reply('❌ אירעה שגיאה: לא נקלטו קבצים.', getMainKeyboard());
    }

    const addedList = [];
    queue.forEach((item, index) => {
      const epNum = startEp + index;
      const epTitle = `${seriesTitle} פרק ${epNum}`;
      db.movies.push({
        id: 'mov_' + Date.now() + '_' + index,
        title: epTitle,
        aliases: [epTitle, seriesTitle],
        from_chat_id: item.from_chat_id,
        message_id: item.message_id
      });
      addedList.push(epTitle);
    });

    if (ctx.session.pendingReqId) {
      db.pendingRequests = (db.pendingRequests || []).filter(r => r.id !== ctx.session.pendingReqId);
    }

    await saveDb(db);
    ctx.session = {};

    return ctx.reply(
      `🎉 <b>הסדרה נקלטה בהצלחה במאגר!</b>\n\n` +
      `📺 <b>סדרה:</b> ${seriesTitle}\n` +
      `📦 <b>סה"כ פרקים:</b> ${addedList.length}`,
      { parse_mode: 'HTML', ...getMainKeyboard() }
    );
  }

  if (step === 'WAIT_FILE') {
    const isMedia = ctx.message.video || ctx.message.document || ctx.message.animation;
    if (!isMedia) return ctx.reply('⚠️️ אנא שלח קובץ וידאו או מסמך תקין.');

    ctx.session.tempMovie = {
      from_chat_id: ctx.chat.id,
      message_id: ctx.message.message_id
    };

    ctx.session.step = 'WAIT_TITLE';

    const defaultTitleMsg = ctx.session.presetTitle 
      ? `\n<i>💡 להגדרת השם המבוקש <code>${ctx.session.presetTitle}</code> פשוט שלח אותו כעת.</i>`
      : '';

    return ctx.reply(
      `✅ הקובץ נקלט!\n\n✍️ <b>שלב 2 מתוך 2:</b> רשום כעת את שמות החיפוש עבור הסרט.${defaultTitleMsg}`,
      { parse_mode: 'HTML' }
    );
  }

  if (step === 'WAIT_TITLE' && ctx.message.text) {
    const input = ctx.message.text.trim();
    const aliases = input.split(/,|,\s*|\n/).map(s => s.trim()).filter(Boolean);
    const mainTitle = aliases[0] || 'סרט ללא שם';

    db.movies.push({
      id: 'mov_' + Date.now(),
      title: mainTitle,
      aliases: aliases,
      from_chat_id: ctx.session.tempMovie.from_chat_id,
      message_id: ctx.session.tempMovie.message_id
    });

    if (ctx.session.pendingReqId) {
      db.pendingRequests = (db.pendingRequests || []).filter(r => r.id !== ctx.session.pendingReqId);
    }

    await saveDb(db);
    ctx.session = {};

    return ctx.reply(
      `🎉 <b>הסרט נשמר בהצלחה!</b>\n\n🎬 <b>שם:</b> ${mainTitle}`,
      { parse_mode: 'HTML', ...getMainKeyboard() }
    );
  }

  if (step === 'WAIT_BACKUP' && ctx.message.document) {
    try {
      const link = await ctx.telegram.getFileLink(ctx.message.document.file_id);
      https.get(link, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', async () => {
          const parsed = JSON.parse(raw);
          if (parsed) {
            db = {
              movies: parsed.movies || [],
              channels: parsed.channels || [],
              pendingRequests: parsed.pendingRequests || []
            };
            await saveDb(db);
            ctx.session = {};
            return ctx.reply(`✅ המאגר שוחזר בהצלחה!`, getMainKeyboard());
          }
        });
      });
      return;
    } catch (e) {
      return ctx.reply('❌ שגיאה בטעינת הקובץ.');
    }
  }

  return next();
});

// ==========================================
// 🔍 מנוע חיפוש בקבוצה + הצגת ערוצים מעוצבים
// ==========================================
function buildSearchKeyboard(searchKey, matches) {
  const buttons = matches.map(m => [Markup.button.callback(`🍿 ${m.title}`, `get_${m.id}`)]);

  buttons.push([
    Markup.button.callback(`📩 שולח בפרטי את כל הפרקים 🎞️`, `sendall_${searchKey}`)
  ]);

  return Markup.inlineKeyboard(buttons);
}

bot.on('message', async (ctx, next) => {
  if (ctx.chat.type === 'private') return next();
  if (!ctx.message.text || ctx.message.text.startsWith('/')) return next();

  const query = ctx.message.text.trim();
  if (query.length < 2) return next();

  const movieMatches = smartSearch(query, db.movies || []);
  const channelMatches = smartSearch(query, db.channels || []);

  if (movieMatches.length === 0 && channelMatches.length === 0) {
    if (!db.pendingRequests) db.pendingRequests = [];
    
    const exists = db.pendingRequests.some(r => normalizeText(r.query) === normalizeText(query));
    if (!exists) {
      db.pendingRequests.push({
        id: 'req_' + Date.now(),
        query: query,
        user: {
          id: ctx.from.id,
          name: ctx.from.first_name || 'משתמש',
          username: ctx.from.username ? `@${ctx.from.username}` : ''
        },
        date: new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })
      });
      await saveDb(db);
    }

    const errReply = await ctx.reply(
      `⚠️ <b>לא נמצאו תוצאות עבור:</b> "<code>${query}</code>"\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📌 <b>הבקשה שלך הועברה אוטומטית למנהלים להוספה!</b>`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message.message_id
      }
    ).catch(() => null);

    if (errReply) {
      autoDeleteMessage(ctx, ctx.chat.id, errReply.message_id, 12000);
    }
    return;
  }

  if (movieMatches.length > 0) {
    const searchKey = 'q_' + Date.now();
    if (!global.searchCache) global.searchCache = new Map();
    global.searchCache.set(searchKey, movieMatches);

    await ctx.reply(
      `🔎 <b>נמצאו ${movieMatches.length} תוצאות עבור:</b> "<b>${query}</b>"\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `בחר פרק מבוקש או לחץ על <b>'שולח בפרטי'</b>:`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message.message_id,
        ...buildSearchKeyboard(searchKey, movieMatches)
      }
    ).catch(() => {});
  }

  if (channelMatches.length > 0) {
    for (const chan of channelMatches) {
      await ctx.reply(
        `✨ <b>נמצא ערוץ רשמי/ייעודי עבור: "${query}"</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 <b>${chan.title}</b>\n\n` +
        `🍿 <i>לצפייה, עדכונים והצטרפות ישירה לערוץ, לחץ על הכפתור למטה:</i>`,
        {
          parse_mode: 'HTML',
          reply_to_message_id: ctx.message.message_id,
          ...Markup.inlineKeyboard([
            [Markup.button.url(`🚀 מעבר ישיר לערוץ: ${chan.title}`, chan.link)]
          ])
        }
      ).catch(() => {});
    }
  }
});

// ==========================================
// 🎞️ שילוח בפרטי
// ==========================================
bot.action(/^sendall_(.+)$/, async (ctx) => {
  const searchKey = ctx.match[1];
  const matches = global.searchCache?.get(searchKey);

  if (!matches || matches.length === 0) {
    return ctx.answerCbQuery('❌ פג תוקף החיפוש, אנא בצע חיפוש חדש בקבוצה.', { show_alert: true });
  }

  const userId = ctx.from.id;
  const senderName = ctx.from?.first_name || 'משתמש';

  ctx.answerCbQuery('🎞️ מעבד שליחה בצ\'אט הפרטי...');

  let successCount = 0;
  let hasError = false;

  for (const movie of matches) {
    try {
      await ctx.telegram.copyMessage(userId, movie.from_chat_id, movie.message_id, {
        caption: BRAND_CAPTION(movie.title),
        parse_mode: 'HTML'
      });
      successCount++;
    } catch (err) {
      hasError = true;
      break;
    }
  }

  if (hasError && successCount === 0) {
    const botUrl = `https://t.me/${BOT_USERNAME || 'bot'}?start=sendall_${searchKey}`;
    
    return ctx.reply(
      `⚠️ <b>שלום ${senderName}!</b>\n` +
      `כדי לקבל את הפרקים בצ'אט הפרטי, עליך להפעיל את הבוט תחילה.\n\n` +
      `👇 <b>לחץ על הכפתור למטה ולחץ START בבוט:</b>`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.callbackQuery.message.message_id,
        ...Markup.inlineKeyboard([
          [Markup.button.url('🚀 לחץ כאן להפעלת הבוט (START) 🎞️', botUrl)]
        ])
      }
    );
  }

  if (successCount > 0) {
    try {
      await ctx.reply(
        `✅ <b>נשלחו ${successCount} פרקים בצ'אט הפרטי עבור ${senderName}!</b> 🍿`,
        {
          parse_mode: 'HTML',
          reply_to_message_id: ctx.callbackQuery.message.message_id
        }
      );
    } catch (e) {}
  }
});

// ==========================================
// 🎬 שליחת קובץ בודד בקבוצה
// ==========================================
bot.action(/^get_(.+)$/, async (ctx) => {
  const movieId = ctx.match[1];
  const movie = db.movies.find(m => m.id === movieId);

  if (!movie) {
    return ctx.answerCbQuery('❌ הסרט אינו זמין עוד במאגר.', { show_alert: true });
  }

  const senderName = ctx.from?.first_name || 'משתמש';
  ctx.answerCbQuery('🍿 שולח את הקובץ...');

  try {
    await ctx.editMessageText(
      `⏳ <b>שולח כעת את:</b> "<b>${movie.title}</b>"\n` +
      `<i>לבקשת: ${senderName}...</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {}

  try {
    await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id, {
      caption: BRAND_CAPTION(movie.title),
      parse_mode: 'HTML'
    });

    await ctx.editMessageText(
      `✅ <b>הקובץ נשלח בהצלחה!</b>\n` +
      `🎬 <b>${movie.title}</b>\n` +
      `👤 לבקשת: <b>${senderName}</b>\n\n` +
      `🍿 <i>צפייה מהנה!</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    try {
      await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id);
    } catch (err) {
      await ctx.editMessageText(`❌ שגיאה בשליחת הקובץ.`, { parse_mode: 'HTML' });
    }
  }
});

// ==========================================
// 🌐 EXPRESS SERVER & KEEP-ALIVE
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('🍿 MOVIE TIME DISPATCHER IS ONLINE!'));
app.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
  if (RENDER_URL) {
    setInterval(() => {
      https.get(RENDER_URL, () => {}).on('error', () => {});
    }, 10 * 60 * 1000);
  }
});

bot.launch().then(async () => {
  try {
    const me = await bot.telegram.getMe();
    BOT_USERNAME = me.username;
    console.log(`🤖 הבוט @${BOT_USERNAME} פועל בהצלחה!`);
  } catch (e) {
    console.log('🤖 הבוט פועל בהצלחה!');
  }
  autoRestoreFromTelegram();
}).catch(err => console.error('❌ שגיאה בהפעלה:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
