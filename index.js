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

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN חסר!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const DB_FILE = path.join(__dirname, 'movies_db.json');

// חותמת מותג אחידה
const BRAND_CAPTION = (title) => 
  `🎬 <b>${title}</b>\n\n` +
  `🍿 <b>MOVIE TIME</b>\n` +
  `🔗 https://t.me/movie_time_by`;

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
    
    // שליחת קובץ גיבוי לאדמין ונעיצתו לטובת שחזור אוטומטי בעתיד
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
  if (db.movies && db.movies.length > 0) return; // יש כבר נתונים

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
  ['➕ הוספת סרט', '🗃️ מאגר סרטים'],
  ['🔄 שחזור ידני מגיבוי']
]).resize();

// ==========================================
// 👑 פאנל ניהול אדמין (שיחה פרטית)
// ==========================================

bot.start((ctx) => {
  if (ctx.chat.type !== 'private') return;
  if (!isAdmin(ctx)) return ctx.reply('⛔ גישה למנהלים בלבד.');

  ctx.session = {};
  return ctx.reply(
    `🍿 <b>MOVIE TIME VIP | BOT ADMIN</b> 🍿\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `הבוט פעיל ומוכן לעבודה בקבוצה!`,
    { parse_mode: 'HTML', ...mainKeyboard }
  );
});

bot.hears('➕ הוספת סרט', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  ctx.session.step = 'WAIT_FILE';
  return ctx.reply(
    `📥 <b>שלב 1 מתוך 2:</b>\n` +
    `שלח או העבר (Forward) אליי כעת את קובץ הסרט.`,
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

  ctx.reply(`📦 <b>סה"כ סרטים במאגר:</b> <code>${db.movies.length}</code>`, { parse_mode: 'HTML' });
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
// 📥 קליטת סרטים וחיפושים בפרטי
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  if (!isAdmin(ctx)) return;

  const step = ctx.session.step;

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
// 🔍 מנוע חיפוש ושילוח בקבוצה
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type === 'private') return next();
  if (!ctx.message.text || ctx.message.text.startsWith('/')) return next();

  const query = ctx.message.text.trim().toLowerCase();
  if (query.length < 2 || db.movies.length === 0) return next();

  // סינון תוצאות לפי מילות החיפוש
  const matches = db.movies.filter(movie =>
    movie.aliases.some(alias => alias.toLowerCase().includes(query) || query.includes(alias.toLowerCase()))
  );

  if (matches.length === 0) return next();

  // אם יש 3 תוצאות ומטה
  if (matches.length <= 3) {
    const buttons = matches.map(m => [Markup.button.callback(`🍿 ${m.title}`, `get_${m.id}`)]);
    return ctx.reply(
      `🔎 נמצאו <b>${matches.length}</b> תוצאות עבור: "<b>${ctx.message.text}</b>"`,
      { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id, ...Markup.inlineKeyboard(buttons) }
    );
  }

  // אם יש מעל 3 תוצאות -> מציגים 3 כפתורים ראשונים + כפתור להצגת כולן
  const top3 = matches.slice(0, 3);
  const buttons = top3.map(m => [Markup.button.callback(`🍿 ${m.title}`, `get_${m.id}`)]);
  
  // מפתח חיפוש מקוצר למעקב
  const searchKey = 'q_' + Date.now();
  if (!global.searchCache) global.searchCache = new Map();
  global.searchCache.set(searchKey, matches);

  buttons.push([Markup.button.callback(`🔍 הצג את כל ${matches.length} התוצאות`, `all_${searchKey}`)]);

  return ctx.reply(
    `🔎 נמצאו <b>${matches.length}</b> תוצאות עבור: "<b>${ctx.message.text}</b>"`,
    { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id, ...Markup.inlineKeyboard(buttons) }
  );
});

// הצגת כל התוצאות
bot.action(/^all_(.+)$/, (ctx) => {
  const searchKey = ctx.match[1];
  const matches = global.searchCache?.get(searchKey);

  if (!matches || matches.length === 0) {
    return ctx.answerCbQuery('❌ התוצאות פגו, בצע חיפוש חדש.', { show_alert: true });
  }

  ctx.answerCbQuery();
  const allButtons = matches.map(m => [Markup.button.callback(`🍿 ${m.title}`, `get_${m.id}`)]);

  return ctx.editMessageText(
    `📋 <b>כל ${matches.length} התוצאות שנמצאו:</b>`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(allButtons) }
  );
});

// שליחת קובץ הסרט בקבוצה
bot.action(/^get_(.+)$/, async (ctx) => {
  const movieId = ctx.match[1];
  const movie = db.movies.find(m => m.id === movieId);

  if (!movie) {
    return ctx.answerCbQuery('❌ הסרט אינו זמין עוד במאגר.', { show_alert: true });
  }

  ctx.answerCbQuery('🍿 שולח את הסרט...');

  try {
    await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id, {
      caption: BRAND_CAPTION(movie.title),
      parse_mode: 'HTML'
    });
  } catch (e) {
    await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id);
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

bot.launch().then(() => {
  console.log('🤖 הבוט פועל בהצלחה!');
  autoRestoreFromTelegram();
}).catch(err => console.error('❌ שגיאה בהפעלה:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
