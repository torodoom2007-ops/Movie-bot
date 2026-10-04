require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '8017590244');
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL; // Render מזין זאת אוטומטית

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN חסר בסביבת העבודה!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const DB_FILE = path.join(__dirname, 'movies_db.json');

// ==========================================
// 💾 מנוע אחסון וגיבוי ענן בטלגרם (Persistence)
// ==========================================
function getDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('⚠️ שגיאה בקריאת קובץ מקומי:', e.message);
  }
  return { targetGroup: null, backupFileId: null, movies: [] };
}

let db = getDb();

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    // גיבוי אוטומטי לפרטי של האדמין בטלגרם
    backupToTelegram();
  } catch (e) {
    console.error('❌ שגיאה בשמירת נתונים:', e.message);
  }
}

async function backupToTelegram() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const doc = await bot.telegram.sendDocument(ADMIN_ID, {
      source: DB_FILE,
      filename: 'movies_db_backup.json'
    }, { caption: '🔄 <b>גיבוי מאגר אוטומטי</b>', parse_mode: 'HTML' });
    
    if (doc?.document?.file_id) {
      db.backupFileId = doc.document.file_id;
    }
  } catch (e) {
    console.error('⚠️ לא ניתן היה לשלוח גיבוי לפרטי:', e.message);
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

const mainKeyboard = Markup.keyboard([
  ['📥 העלאת סרטים (Batch)', '🗃️ מאגר סרטים'],
  ['⚙️ הגדרת קבוצה', '🔄 שחזור מאגר מגיבוי'],
  ['📊 דוח סטטוס']
]).resize();

// ==========================================
// 👑 פאנל ניהול אדמין
// ==========================================

bot.start((ctx) => {
  if (ctx.chat.type !== 'private') return;
  if (!isAdmin(ctx)) return ctx.reply('⛔ אין לך הרשאה לגשת למערכת הניהול.');

  ctx.session = {};
  return ctx.reply(
    `✨ <b>MOVIE TIME VIP | ARCHIVE DISPATCHER</b> ✨\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `אהלן אדמין! המערכת מותאמת להעלאה מהירה של עד 10 סרטים במקביל.`,
    { parse_mode: 'HTML', ...mainKeyboard }
  );
});

bot.hears('🗃️️ מאגר סרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  return ctx.reply(
    `🗃️ <b>מאגר הסרטים בארכיון</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>סה"כ סרטים שמורים:</b> <code>${db.movies.length}</code>\n\n` +
    `בחר פעולה:`,
    {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        ['✏️ עריכת/מחיקת סרטים'],
        ['📥 העלאת סרטים (Batch)', '🔙 חזרה לתפריט ראשי']
      ]).resize()
    }
  );
});

bot.hears('📊 דוח סטטוס', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  return ctx.reply(
    `📊 <b>סטטוס מערכת:</b>\n\n` +
    `🍿 <b>סרטים במאגר:</b> <code>${db.movies.length}</code>\n` +
    `👥 <b>קבוצה מקושרת:</b> <code>${db.targetGroup || 'טרם הוגדרה'}</code>\n` +
    `🟢 <b>מצב שרת:</b> Online & Active`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('🔙 חזרה לתפריט ראשי', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session = {};
  return ctx.reply('חזרת לתפריט הראשי.', mainKeyboard);
});

bot.hears('⚙️ הגדרת קבוצה', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session.step = 'WAIT_GROUP_ID';
  return ctx.reply(
    `👥 <b>הגדרת קבוצת יעד</b>\n\n` +
    `שלח כעת את ה-ID של הקבוצה (למשל: <code>-100123456789</code>).`,
    { parse_mode: 'HTML' }
  );
});

// ==========================================
// 🚀 מנגנון העלאה מרוכזת (BATCH ADDITION)
// ==========================================

bot.hears('📥 העלאת סרטים (Batch)', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  ctx.session.step = 'BATCH_MODE';
  ctx.session.pendingMovies = [];

  return ctx.reply(
    `📥 <b>מצב העלאה מרוכזת פתוח!</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `העבר (Forward) או שלח אליי כעת <b>עד 10 סרטים/קבצים</b> ברצף.\n\n` +
    `הבוט יזהה אוטומטית את שמות הקבצים והכותרות.\n` +
    `בסיום, לחץ על הכפתור <b>"💾 שמור את כל הסרטים"</b>.`,
    {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        ['💾 שמור את כל הסרטים'],
        ['❌ ביטול העלאה']
      ]).resize()
    }
  );
});

bot.hears('❌ ביטול העלאה', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session = {};
  return ctx.reply('ההעלאה בוטלה.', mainKeyboard);
});

bot.hears('💾 שמור את כל הסרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  const pending = ctx.session.pendingMovies || [];

  if (pending.length === 0) {
    return ctx.reply('⚠️ לא נקלטו סרטים לשמירה. שלח קבצים ראשית.');
  }

  // הוספת כל הסרטים בבת אחת למאגר
  let addedCount = 0;
  pending.forEach(item => {
    const movieId = 'mov_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    db.movies.push({
      id: movieId,
      title: item.title,
      from_chat_id: item.from_chat_id,
      message_id: item.message_id,
      aliases: item.aliases
    });
    addedCount++;
  });

  saveDb(db);

  ctx.session.step = null;
  ctx.session.pendingMovies = [];

  return ctx.reply(
    `✅ <b>העלאה הושלמה בהצלחה!</b>\n` +
    `נוספו <b>${addedCount}</b> סרטים חדשים לארכיון.\n` +
    `📦 סה"כ במאגר כעת: <code>${db.movies.length}</code>`,
    { parse_mode: 'HTML', ...mainKeyboard }
  );
});

// ==========================================
// 🔄 שחזור מאגר מגיבוי
// ==========================================
bot.hears('🔄 שחזור מאגר מגיבוי', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session.step = 'WAIT_BACKUP_FILE';
  return ctx.reply(
    `📥 <b>שחזור מאגר מגיבוי</b>\n\n` +
    `שלח כעת את קובץ ה-<code>movies_db_backup.json</code> שנשלח אליך בעבר.`,
    { parse_mode: 'HTML' }
  );
});

// ==========================================
// 📥 קליטת פקודות והודעות אדמין
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  if (!isAdmin(ctx)) return;

  const step = ctx.session.step;
  const text = ctx.message.text;

  // הגדרת קבוצה
  if (step === 'WAIT_GROUP_ID' && text) {
    if (!text.startsWith('-100')) {
      return ctx.reply('⚠️ מזהה קבוצה חייב להתחיל ב-`-100`. נסה שוב:');
    }
    db.targetGroup = text.trim();
    saveDb(db);
    ctx.session.step = null;
    return ctx.reply(`✅ הקבוצה עודכנה: <code>${db.targetGroup}</code>`, { parse_mode: 'HTML', ...mainKeyboard });
  }

  // שחזור מקובץ גיבוי
  if (step === 'WAIT_BACKUP_FILE' && ctx.message.document) {
    try {
      const fileLink = await ctx.telegram.getFileLink(ctx.message.document.file_id);
      https.get(fileLink, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const restoredDb = JSON.parse(data);
          if (restoredDb && Array.isArray(restoredDb.movies)) {
            db = restoredDb;
            saveDb(db);
            ctx.session.step = null;
            return ctx.reply(`✅ <b>המאגר שוחזר בהצלחה!</b>\nטוען <code>${db.movies.length}</code> סרטים.`, { parse_mode: 'HTML', ...mainKeyboard });
          } else {
            return ctx.reply('❌ הקובץ אינו במבנה תקין.');
          }
        });
      });
      return;
    } catch (e) {
      return ctx.reply('❌ שגיאה בטעינת קובץ הגיבוי.');
    }
  }

  // קליטת קבצים במצב Batch Mode
  if (step === 'BATCH_MODE') {
    if (text && ['💾 שמור את כל הסרטים', '❌ ביטול העלאה'].includes(text)) return next();

    // חילוץ שם הסרט אוטומטית
    let extractedTitle = ctx.message.caption || 
                         ctx.message.document?.file_name || 
                         ctx.message.video?.file_name || 
                         'סרט ' + ((ctx.session.pendingMovies?.length || 0) + 1);

    // ניקוי סיומות קבצים נפוצות
    extractedTitle = extractedTitle.replace(/\.(mp4|mkv|avi|mov)$/i, '').trim();

    if (!ctx.session.pendingMovies) ctx.session.pendingMovies = [];

    if (ctx.session.pendingMovies.length >= 10) {
      return ctx.reply('⚠️ הגעת למקסימום של 10 סרטים בבת אחת! לחץ "💾 שמור את כל הסרטים" כדי להכניסם.');
    }

    ctx.session.pendingMovies.push({
      title: extractedTitle,
      from_chat_id: ctx.chat.id,
      message_id: ctx.message.message_id,
      aliases: [extractedTitle.toLowerCase(), extractedTitle]
    });

    const count = ctx.session.pendingMovies.length;
    return ctx.reply(
      `📥 <b>נקלט סרט ${count} מתוך 10!</b>\n` +
      `🎬 <b>כותרת:</b> <code>${extractedTitle}</code>\n\n` +
      `<i>המשך לשלוח קבצים נוספים או לחץ "💾 שמור את כל הסרטים" לסיום.</i>`,
      { parse_mode: 'HTML' }
    );
  }

  return next();
});

// ==========================================
// ✏️ עריכת/מחיקת סרטים
// ==========================================
bot.hears('✏️ עריכת/מחיקת סרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  if (db.movies.length === 0) return ctx.reply('🗃️️ המאגר ריק כרגע.');

  ctx.reply('📋 <b>רשימת הסרטים בארכיון:</b>', { parse_mode: 'HTML' });
  db.movies.forEach((movie, index) => {
    ctx.reply(`<b>${index + 1}. ${movie.title}</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🗑️ מחק סרט', `del_${movie.id}`)]
      ])
    });
  });
});

bot.action(/^del_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ אין הרשאה');
  const movieId = ctx.match[1];
  db.movies = db.movies.filter(m => m.id !== movieId);
  saveDb(db);
  ctx.answerCbQuery('🗑️ הסרט נמחק!');
  return ctx.editMessageText('❌ <i>סרט זה נמחק מהמאגר.</i>', { parse_mode: 'HTML' });
});

// ==========================================
// 🔍 מנוע החיפוש והשילוח בקבוצה
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type === 'private') return next();
  if (db.targetGroup && String(ctx.chat.id) !== String(db.targetGroup)) return next();
  if (!ctx.message.text || ctx.message.text.startsWith('/')) return next();

  const query = ctx.message.text.trim().toLowerCase();
  if (!query || db.movies.length === 0) return next();

  const matchedMovies = db.movies.filter(movie => {
    return movie.aliases.some(alias => alias.toLowerCase().includes(query) || query.includes(alias.toLowerCase()));
  });

  if (matchedMovies.length > 0) {
    const results = matchedMovies.slice(0, 8);
    const inlineButtons = results.map(movie => [
      Markup.button.callback(`🍿 ${movie.title}`, `getmov_${movie.id}`)
    ]);

    const searchMsg = 
      `✨ <b>MOVIE TIME | ARCHIVE DISPATCHER</b> ✨\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔎 נמצאו <b>${matchedMovies.length}</b> כותרים עבור: "<b>${ctx.message.text}</b>"\n\n` +
      `👇 <i>לחץ לקבלת הקובץ:</i>`;

    try {
      await ctx.reply(searchMsg, {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message.message_id,
        ...Markup.inlineKeyboard(inlineButtons)
      });
    } catch (err) {
      console.error('שגיאה בשליחת תוצאות:', err);
    }
  }
});

// ==========================================
// 🔘 CLICK HANDLER (SEND FILE TO GROUP)
// ==========================================
bot.action(/^getmov_(.+)$/, async (ctx) => {
  const movieId = ctx.match[1];
  const movie = db.movies.find(m => m.id === movieId);

  if (!movie) {
    return ctx.answerCbQuery('❌ הסרט אינו זמין עוד במאגר.', { show_alert: true });
  }

  ctx.answerCbQuery('🍿 שולח את הסרט כעת...');

  const BRAND_FOOTER = 
    `\n\n━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🍿 <b>הועבר באהבה מצוות MOVIE TIME</b>\n` +
    `🔗 <a href="https://t.me/movie_time_by">לחץ כאן להצטרפות לערוץ הרשמי</a> 🍿`;

  try {
    await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id, {
      caption: `🎬 <b>${movie.title}</b>` + BRAND_FOOTER,
      parse_mode: 'HTML'
    });
  } catch (e) {
    await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id);
  }
});

// ==========================================
// 🌐 EXPRESS SERVER & KEEP-ALIVE SELF PING
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('🍿 MOVIE TIME ARCHIVE is Active & Online! 🚀'));
app.listen(PORT, () => {
  console.log(`[SERVER] Listening on port ${PORT}`);
  
  // Self-Ping כל 10 דקות למניעת הירדמות ב-Render
  if (RENDER_URL) {
    setInterval(() => {
      https.get(RENDER_URL, (res) => {
        console.log(`[KEEP-ALIVE] Ping sent to ${RENDER_URL}`);
      }).on('error', (e) => {});
    }, 10 * 60 * 1000);
  }
});

bot.launch()
  .then(() => console.log('🤖 הבוט פועל ומחובר בהצלחה!'))
  .catch((err) => console.error('❌ שגיאת הפעלה:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
