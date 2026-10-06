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

let BOT_USERNAME = ''; // ייטען אוטומטית בעת הפעלת הבוט

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
// 🧠 מנוע חיפוש חכם ונרמול טקסט
// ==========================================

// נרמול טקסט (טיפול באותיות סופיות, ניקוי פיסוק ורווחים)
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

// אלגוריתם דירוג חיפוש חכם
function smartSearch(query, movies) {
  const cleanQuery = normalizeText(query);
  if (!cleanQuery) return [];

  const queryWords = cleanQuery.split(' ').filter(w => w.length > 0);

  const scored = movies.map(movie => {
    let maxScore = 0;
    
    for (const alias of (movie.aliases || [])) {
      const cleanAlias = normalizeText(alias);
      if (!cleanAlias) continue;

      if (cleanAlias === cleanQuery) {
        maxScore = Math.max(maxScore, 100); // התאמה מדויקת
      } else if (cleanAlias.startsWith(cleanQuery)) {
        maxScore = Math.max(maxScore, 80);  // מתחיל בשילוב המבוקש
      } else if (cleanAlias.includes(cleanQuery)) {
        maxScore = Math.max(maxScore, 60);  // מכיל את המחרוזת
      } else {
        // חיפוש לפי מילים בודדות
        const aliasWords = cleanAlias.split(' ');
        const matchedWords = queryWords.filter(qw => 
          aliasWords.some(aw => aw.includes(qw) || qw.includes(aw))
        );
        if (matchedWords.length === queryWords.length) {
          maxScore = Math.max(maxScore, 50); // מכיל את כל המילים
        } else if (matchedWords.length > 0) {
          maxScore = Math.max(maxScore, 20 * matchedWords.length); // התאמה חלקית
        }
      }
    }
    return { movie, score: maxScore };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.movie);
}

// עוזר למחיקה אוטומטית לשמירה על פיד נקי
function autoDeleteMessage(ctx, chatId, messageId, delayMs = 12000) {
  setTimeout(async () => {
    try {
      await ctx.telegram.deleteMessage(chatId, messageId);
    } catch (e) {
      // הודעות שכבר נמחקו/אין הרשאה
    }
  }, delayMs);
}

// ==========================================
// 💾 מנגנון מאגר נתונים + גיבוי ענן אוטומטי
// ==========================================
function loadLocalDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('⚠️ שגיאה בקריאת מאגר מקומי:', e.message);
  }
  return { movies: [] };
}

let db = loadLocalDb();

// שמירה + גיבוי ונעיצה אוטומטית בטלגרם
async function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    
    const doc = await bot.telegram.sendDocument(ADMIN_ID, {
      source: DB_FILE,
      filename: 'movies_db.json'
    }, { caption: '🔄 <b>גיבוי מאגר אוטומטי</b>', parse_mode: 'HTML' });

    if (doc?.message_id) {
      await bot.telegram.pinChatMessage(ADMIN_ID, doc.message_id, { disable_notification: true }).catch(() => {});
    }
  } catch (e) {
    console.error('❌ שגיאה בשמירת/גיבוי המאגר:', e.message);
  }
}

// שחזור אוטומטי מנעיצת טלגרם בעת הפעלה מחדש
async function autoRestoreFromTelegram() {
  if (db.movies && db.movies.length > 0) return;

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
            if (restored && Array.isArray(restored.movies)) {
              db = restored;
              fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
              console.log(`✅ שוחזרו בהצלחה ${db.movies.length} סרטים מהגיבוי בענן!`);
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
// 🛡️ MIDDLEWARES
// ==========================================
bot.use(session());
bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  return next();
});

const isAdmin = (ctx) => String(ctx.from?.id) === ADMIN_ID;

const mainKeyboard = Markup.keyboard([
  ['➕ הוספת סרט', '📺 הוספת סדרה'],
  ['🗃️ מאגר סרטים', '🔄 שחזור ידני מגיבוי']
]).resize();

// ==========================================
// 🚀 טיפול ברוט /START וקישורי עומק (Deep Links)
// ==========================================

bot.start(async (ctx) => {
  const payload = ctx.startPayload; // נקלט בעת לחיצה על קישור start=...

  // אם המשתמש הגיע דרך קישור שליחה אוטומטית בפרטי
  if (payload) {
    if (payload.startsWith('sendall_')) {
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
          } catch (err) {
            console.error('Error sending file in PM:', err.message);
          }
        }
        return ctx.reply(`✅ <b>כל הפרקים נשלחו בהצלחה! צפייה מהנה!</b> 🍿`, { parse_mode: 'HTML' });
      } else {
        return ctx.reply('⚠️ פג תוקף החיפוש או שהקבצים אינם זמינים עוד. אנא בצע חיפוש חדש בקבוצה.');
      }
    } else if (payload.startsWith('get_')) {
      const movieId = payload.replace('get_', '');
      const movie = db.movies.find(m => m.id === movieId);
      if (movie) {
        try {
          await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id, {
            caption: BRAND_CAPTION(movie.title),
            parse_mode: 'HTML'
          });
          return ctx.reply(`✅ <b>הקובץ נשלח בהצלחה! צפייה מהנה!</b> 🍿`, { parse_mode: 'HTML' });
        } catch (err) {
          return ctx.reply('❌ שגיאה בשליחת הקובץ.');
        }
      } else {
        return ctx.reply('❌ הסרט אינו זמין עוד במאגר.');
      }
    }
  }

  // תפריט ראשי למנהל בפרטי
  if (isAdmin(ctx)) {
    ctx.session = {};
    return ctx.reply(
      `🍿 <b>MOVIE TIME VIP | BOT ADMIN</b> 🍿\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ הבוט פעיל ומוכן לעבודה בקבוצה!`,
      { parse_mode: 'HTML', ...mainKeyboard }
    );
  } else {
    // הודעת פתיחה למשתמש רגיל בצ'אט הפרטי
    return ctx.reply(
      `🍿 <b>ברוכים הבאים ל-MOVIE TIME VIP!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `כדי לחפש סרטים וסדרות, פשוט הקלד את שם הסרט/הסדרה בקבוצה שלנו!`,
      { parse_mode: 'HTML' }
    );
  }
});

// ==========================================
// 👑 פאנל ניהול אדמין (שיחה פרטית)
// ==========================================

bot.hears('➕ הוספת סרט', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  ctx.session.step = 'WAIT_FILE';
  return ctx.reply(
    `📥 <b>שלב 1 מתוך 2:</b>\n` +
    `שלח או העבר (Forward) אליי כעת את קובץ הסרט.`,
    { parse_mode: 'HTML', ...Markup.keyboard([['❌ ביטול']]).resize() }
  );
});

// 📺 הוספת סדרה בלחיצה אחת
bot.hears('📺 הוספת סדרה', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  ctx.session.step = 'WAIT_SERIES_FILES';
  ctx.session.seriesQueue = [];
  return ctx.reply(
    `📺 <b>הוספת סדרה במהירות:</b>\n\n` +
    `1️⃣ העבר (Forward) או שלח אליי את קובצי הפרקים <b>לפי הסדר</b> (פרק 1, פרק 2 וכו').\n` +
    `2️⃣ בסיום העברת כל הקבצים, לחץ על הכפתור <b>'✅ סיימתי להעלות פרקים'</b>.`,
    { parse_mode: 'HTML', ...Markup.keyboard([['✅ סיימתי להעלות פרקים'], ['❌ ביטול']]).resize() }
  );
});

bot.hears('✅ סיימתי להעלות פרקים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  if (ctx.session.step !== 'WAIT_SERIES_FILES' || !ctx.session.seriesQueue || ctx.session.seriesQueue.length === 0) {
    return ctx.reply('⚠️ לא נקלטו קבצים עדיין. אנא שלח קובצי פרקים תחילה.');
  }

  const count = ctx.session.seriesQueue.length;
  ctx.session.step = 'WAIT_SERIES_NAME';

  return ctx.reply(
    `🎉 <b>נקלטו ${count} פרקים בהצלחה!</b>\n\n` +
    `✍ <b>שלב אחרון:</b>\n` +
    `שלח כעת את שם הסדרה והעונה (למשל: <code>סדרה עונה 1</code>).\n\n` +
    `<i>💡 רוצה להתחיל מפרק מסוים? (למשל מפרק 5 והלאה): רשום <code>סדרה עונה 1 | 5</code></i>`,
    { parse_mode: 'HTML', ...Markup.keyboard([['❌ ביטול']]).resize() }
  );
});

bot.hears('❌ ביטול', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session = {};
  return ctx.reply('הפעולה בוטלה.', mainKeyboard);
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
// 📥 קליטת סרטים, סדרות וחיפושים בפרטי
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  if (!isAdmin(ctx)) return;

  const step = ctx.session.step;

  // קליטת קבצים סדרתיים לתור
  if (step === 'WAIT_SERIES_FILES') {
    const isMedia = ctx.message.video || ctx.message.document || ctx.message.animation;
    if (isMedia) {
      if (!ctx.session.seriesQueue) ctx.session.seriesQueue = [];
      ctx.session.seriesQueue.push({
        from_chat_id: ctx.chat.id,
        message_id: ctx.message.message_id
      });

      const count = ctx.session.seriesQueue.length;
      return ctx.reply(`📥 <b>פרק #${count} נקלט בתור!</b>\nלחץ '✅ סיימתי להעלות פרקים' בסיום.`, { parse_mode: 'HTML' });
    }
  }

  // קליטת שם הסדרה והחלת השמות האוטומטית
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
      return ctx.reply('❌ אירעה שגיאה: לא נקלטו קבצים.', mainKeyboard);
    }

    const addedList = [];
    queue.forEach((item, index) => {
      const epNum = startEp + index;
      const epTitle = `${seriesTitle} פרק ${epNum}`;
      const newMovie = {
        id: 'mov_' + Date.now() + '_' + index,
        title: epTitle,
        aliases: [epTitle],
        from_chat_id: item.from_chat_id,
        message_id: item.message_id
      };
      db.movies.push(newMovie);
      addedList.push(epTitle);
    });

    await saveDb(db);

    ctx.session = {};
    return ctx.reply(
      `🎉 <b>הסדרה נקלטה בהצלחה במאגר!</b>\n\n` +
      `📺 <b>סדרה:</b> ${seriesTitle}\n` +
      `📦 <b>סה"כ פרקים שנוספו:</b> ${addedList.length}\n\n` +
      `📋 <b>רשימת הפרקים:</b>\n` +
      addedList.map(t => `• <code>${t}</code>`).join('\n'),
      { parse_mode: 'HTML', ...mainKeyboard }
    );
  }

  // קליטת קובץ הסרט
  if (step === 'WAIT_FILE') {
    const isMedia = ctx.message.video || ctx.message.document || ctx.message.animation;
    if (!isMedia) {
      return ctx.reply('⚠️ אנא שלח קובץ וידאו או מסמך סרט תקין.');
    }

    ctx.session.tempMovie = {
      from_chat_id: ctx.chat.id,
      message_id: ctx.message.message_id
    };

    ctx.session.step = 'WAIT_TITLE';
    return ctx.reply(
      `✅ הקובץ נקלט בהצלחה!\n\n` +
      `✍️ <b>שלב 2 מתוך 2:</b>\n` +
      `רשום כעת את שמות החיפוש עבור הסרט.\n` +
      `<i>(ניתן להזין כמה שמות מופרדים בפסיקים, למשל: <code>סרט 1, movie 1, הסרט הראשון</code>)</i>`,
      { parse_mode: 'HTML' }
    );
  }

  // קליטת שמות החיפוש
  if (step === 'WAIT_TITLE' && ctx.message.text) {
    const input = ctx.message.text.trim();
    const aliases = input.split(/,|,\s*|\n/).map(s => s.trim()).filter(Boolean);
    const mainTitle = aliases[0] || 'סרט ללא שם';

    const newMovie = {
      id: 'mov_' + Date.now(),
      title: mainTitle,
      aliases: aliases,
      from_chat_id: ctx.session.tempMovie.from_chat_id,
      message_id: ctx.session.tempMovie.message_id
    };

    db.movies.push(newMovie);
    await saveDb(db);

    ctx.session = {};
    return ctx.reply(
      `🎉 <b>הסרט נשמר בהצלחה במאגר!</b>\n\n` +
      `🎬 <b>שם ראשי:</b> ${newMovie.title}\n` +
      `🔍 <b>מילות חיפוש:</b> <code>${newMovie.aliases.join(', ')}</code>`,
      { parse_mode: 'HTML', ...mainKeyboard }
    );
  }

  // שחזור ידני
  if (step === 'WAIT_BACKUP' && ctx.message.document) {
    try {
      const link = await ctx.telegram.getFileLink(ctx.message.document.file_id);
      https.get(link, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', async () => {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.movies)) {
            db = parsed;
            await saveDb(db);
            ctx.session = {};
            return ctx.reply(`✅ המאגר שוחזר בהצלחה! נטענו ${db.movies.length} סרטים.`, mainKeyboard);
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
// 🔍 מנוע חיפוש ושילוח בקבוצה ("הצג הכל" ושליחה בפרטי)
// ==========================================

// בניית מקלדת מותאמת - הצגת כל התוצאות ללא דפדוף + כפתור שליחה בפרטי
function buildSearchKeyboard(searchKey, matches) {
  // יוצרים כפתור לכל פרק/סרט שנמצא ("הצג הכל")
  const buttons = matches.map(m => [Markup.button.callback(`🍿 ${m.title}`, `get_${m.id}`)]);

  // מוסיפים בתחתית כפתור מרכזי לשליחת כל הפרקים בצ'אט הפרטי
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

  // חיפוש חכם
  const matches = smartSearch(query, db.movies || []);

  // אם לא נמצאו תוצאות
  if (matches.length === 0) {
    const errReply = await ctx.reply(
      `⚠️ <b>לא נמצאו תוצאות עבור:</b> "<code>${query}</code>"\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `נא לחפש שם מדויק של סרט או סדרה בלבד.`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message.message_id
      }
    );
    // מחיקה אוטומטית לשמירה על פיד נקי
    autoDeleteMessage(ctx, ctx.chat.id, errReply.message_id, 12000);
    return;
  }

  // שמירה ב-Cache עבור שליחה מרוכזת
  const searchKey = 'q_' + Date.now();
  if (!global.searchCache) global.searchCache = new Map();
  global.searchCache.set(searchKey, matches);

  return ctx.reply(
    `🔎 <b>נמצאו ${matches.length} תוצאות עבור:</b> "<b>${query}</b>"\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `בחר פרק ספציפי או לחץ על <b>'שולח בפרטי'</b> לקבלת כל הפרקים:`,
    {
      parse_mode: 'HTML',
      reply_to_message_id: ctx.message.message_id,
      ...buildSearchKeyboard(searchKey, matches)
    }
  );
});

// ==========================================
// 🎞️ טיפול בלחיצה על "שולח בפרטי את כל הפרקים"
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

  // ננסה לשלוח ישירות לפרטי של המשתמש
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
      break; // אם נכשל (למשל כי המשתמש לא לחץ START בפרטי), נעצור ונציע כפתור START
    }
  }

  // אם הבוט לא יכול לשלוח הודעה בפרטי (המשתמש לא הפעיל את הבוט עדיין)
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

  // הודעת אישור בקבוצה על השליחה
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
// 🎬 שליחת קובץ בודד בקבוצה (פיד נקי)
// ==========================================

bot.action(/^get_(.+)$/, async (ctx) => {
  const movieId = ctx.match[1];
  const movie = db.movies.find(m => m.id === movieId);

  if (!movie) {
    return ctx.answerCbQuery('❌ הסרט אינו זמין עוד במאגר.', { show_alert: true });
  }

  const senderName = ctx.from?.first_name || 'משתמש';
  ctx.answerCbQuery('🍿 שולח את הקובץ...');

  // עריכת הודעת התפריט להודעת טעינה נקייה
  try {
    await ctx.editMessageText(
      `⏳ <b>שולח כעת את:</b> "<b>${movie.title}</b>"\n` +
      `<i>לבקשת: ${senderName}...</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {}

  try {
    // העתקת/שליחת המדיה בקבוצה
    await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id, {
      caption: BRAND_CAPTION(movie.title),
      parse_mode: 'HTML'
    });

    // עדכון הודעת התפריט לאישור שנשלח
    await ctx.editMessageText(
      `✅ <b>הקובץ נשלח בהצלחה!</b>\n` +
      `🎬 <b>${movie.title}</b>\n` +
      `👤 לבקשת: <b>${senderName}</b>\n\n` +
      `🍿 <i>צפייה מהנה! לחיפוש נוסף הקלד את השם בקבוצה.</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    // במקרה של שגיאה בשליחת המדיה בקבוצה
    try {
      await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id);
    } catch (err) {
      await ctx.editMessageText(`❌ שגיאה בשליחת הקובץ. וודא שהקובץ קיים במקור.`, { parse_mode: 'HTML' });
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
