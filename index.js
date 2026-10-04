require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '8017590244');
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('❌ שגיאה קריטית: BOT_TOKEN לא מוגדר בסביבה!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ==========================================
// 💾 מנוע אחסון נתונים (JSON Database)
// ==========================================
const DB_FILE = path.join(__dirname, 'movies_db.json');

function getDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { targetGroup: null, movies: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { targetGroup: null, movies: [] };
  }
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let db = getDb();

// ==========================================
// 🛡️ MIDDLEWARES & HELPER FUNCTIONS
// ==========================================
bot.use(session());

bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  return next();
});

const isAdmin = (ctx) => String(ctx.from?.id) === ADMIN_ID;

const mainKeyboard = Markup.keyboard([
  ['🗃️ מאגר סרטים', '➕ הוספת סרט'],
  ['⚙️ הגדרת קבוצה', '📊 סטטיסטיקות']
]).resize();

// ==========================================
// 👑 פאנל ניהול אדמין (שיחה פרטית בלבד)
// ==========================================

bot.start((ctx) => {
  if (ctx.chat.type !== 'private') return;
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔ אין לך הרשאה לגשת למערכת הניהול.');
  }
  ctx.session = {};
  return ctx.reply(
    `🎬 <b>מערכת ניהול סרטים וסדרות - PANEL CONTROL</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `שלום אדמין! המערכת פעילה ומוכנה לקבלת תוכן ולשילוח בקבוצות.`,
    { parse_mode: 'HTML', ...mainKeyboard }
  );
});

bot.hears('🗃️ מאגר סרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  const count = db.movies.length;
  return ctx.reply(
    `🗃️ <b>מאגר סרטים וסדרות</b>\n━━━━━━━━━━━━━━━━━━━━━━\n📦 <b>סה"כ סרטים במאגר:</b> <code>${count}</code>\n\nבחר פעולה:`,
    {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        ['✏️ עריכת/מחיקת סרטים'],
        ['➕ הוספת סרט', '🔙 חזרה לתפריט ראשי']
      ]).resize()
    }
  );
});

bot.hears('📊 סטטיסטיקות', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  const count = db.movies.length;
  const group = db.targetGroup ? `<code>${db.targetGroup}</code>` : '❌ טרם הוגדרה';
  return ctx.reply(
    `📊 <b>דוח סטטוס מערכת:</b>\n\n` +
    `🍿 <b>סרטים במאגר:</b> <code>${count}</code>\n` +
    `👥 <b>קבוצת יעד מקושרת:</b> ${group}\n` +
    `🟢 <b>סטטוס שרת:</b> פעיל (Online)`,
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
    `הקבוצה הנוכחית: <code>${db.targetGroup || 'טרם הוגדרה'}</code>\n\n` +
    `שלח כעת את ה-ID של הקבוצה (למשל: <code>-100123456789</code>).`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('➕ הוספת סרט', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  ctx.session.step = 'WAIT_MOVIE_MEDIA';
  return ctx.reply(
    `📥 <b>שלב 1 מתוך 2: קליטת הקובץ</b>\n\n` +
    `העבר (Forward) או שלח אליי כעת את הודעת הסרט/סדרה מטלגרם.`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('✏️ עריכת/מחיקת סרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  if (db.movies.length === 0) {
    return ctx.reply('🗃️ המאגר ריק כרגע.');
  }
  ctx.reply('📋 <b>רשימת הסרטים במאגר:</b>', { parse_mode: 'HTML' });
  db.movies.forEach((movie, index) => {
    const text = `<b>${index + 1}. ID:</b> <code>${movie.id}</code>\n🏷️ <b>כינויים:</b> <code>${movie.aliases.join(', ')}</code>`;
    ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🗑️ מחק סרט', `del_${movie.id}`)]
      ])
    });
  });
});

// ==========================================
// 🔘 CALLBACK INLINE HANDLERS
// ==========================================
bot.action(/^del_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ אין הרשאה');
  const movieId = ctx.match[1];
  db.movies = db.movies.filter(m => m.id !== movieId);
  saveDb(db);
  ctx.answerCbQuery('🗑️ הסרט נמחק בהצלחה!');
  return ctx.editMessageText('❌ <i>סרט זה נמחק מהמאגר.</i>', { parse_mode: 'HTML' });
});

// ==========================================
// 📥 ADMIN WIZARD (MESSAGE FLOW)
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  if (!isAdmin(ctx)) return;

  const step = ctx.session.step;
  const text = ctx.message.text;

  if (text && ['🗃️ מאגר סרטים', '➕ הוספת סרט', '⚙️ הגדרת קבוצה', '🔙 חזרה לתפריט ראשי', '✏️ עריכת/מחיקת סרטים', '📊 סטטיסטיקות'].includes(text)) {
    ctx.session.step = null;
    return next();
  }

  // הגדרת ID של קבוצה
  if (step === 'WAIT_GROUP_ID') {
    if (!text || !text.startsWith('-100')) {
      return ctx.reply('⚠️ מזהה קבוצה חייב להיות מספר שמתחיל ב-`-100`. נסה שוב:');
    }
    db.targetGroup = text.trim();
    saveDb(db);
    ctx.session.step = null;
    return ctx.reply(`✅ <b>הקבוצה הוגדרה בהצלחה!</b>\nID: <code>${db.targetGroup}</code>`, { parse_mode: 'HTML', ...mainKeyboard });
  }

  // שלב 1: קליטת הקובץ המועבר
  if (step === 'WAIT_MOVIE_MEDIA') {
    ctx.session.tempMovie = {
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id
    };
    ctx.session.step = 'WAIT_MOVIE_ALIASES';
    return ctx.reply(
      `🏷️ <b>שלב 2 מתוך 2: הזנת כינויים</b>\n\n` +
      `הסרט נקלט בהצלחה! כעת שלח את הכינויים מופרדים בפסיקים.\n\n` +
      `<i>דוגמה:</i> <code>אנגרי בירדס 1, אנגרי בירדס, angry birds 1</code>`,
      { parse_mode: 'HTML' }
    );
  }

  // שלב 2: הזנת כינויים ובדיקת כפילויות
  if (step === 'WAIT_MOVIE_ALIASES') {
    if (!text) {
      return ctx.reply('⚠️ נא לשלוח טקסט בלבד עם הכינויים מופרדים בפסיקים.');
    }

    const rawAliases = text.split(',');
    const cleanAliases = rawAliases.map(a => a.trim().toLowerCase()).filter(a => a.length > 0);

    if (cleanAliases.length === 0) {
      return ctx.reply('⚠️ לא הוגדרו כינויים תקינים. נסה שוב:');
    }

    // 🛡️ מנגנון בדיקת כפילויות קשיח
    const duplicates = [];
    db.movies.forEach(m => {
      m.aliases.forEach(existing => {
        cleanAliases.forEach(newA => {
          if (existing === newA) duplicates.push(newA);
        });
      });
    });

    if (duplicates.length > 0) {
      ctx.session.step = null;
      ctx.session.tempMovie = null;
      return ctx.reply(
        `⚠️ <b>כפילות זוהתה במערכת!</b>\n\n` +
        `הכינוי/ים הבאים כבר קיימים עבור סרט אחר במאגר:\n❌ <code>${duplicates.join(', ')}</code>\n\n` +
        `הפעולה בוטלה! לחץ שוב "➕ הוספת סרט" והזן כינויים ייחודיים.`,
        { parse_mode: 'HTML', ...mainKeyboard }
      );
    }

    const movieId = 'mov_' + Date.now();
    const newMovie = {
      id: movieId,
      from_chat_id: ctx.session.tempMovie.chat_id,
      message_id: ctx.session.tempMovie.message_id,
      aliases: cleanAliases
    };

    db.movies.push(newMovie);
    saveDb(db);

    ctx.session.step = null;
    ctx.session.tempMovie = null;

    return ctx.reply(
      `✅ <b>הסרט נשמר במאגר בהצלחה!</b>\n\n🏷️ <b>כינויים שנרשמו:</b>\n<code>${cleanAliases.join(' | ')}</code>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🗑️ מחק סרט זה כעת', `del_${movieId}`)]
        ])
      }
    );
  }

  return next();
});

// ==========================================
// 🔍 מנוע החיפוש והשילוח הדינמי בקבוצה
// ==========================================
bot.on('message', async (ctx) => {
  // עובד רק בקבוצות ולא בשיחות פרטיות
  if (ctx.chat.type === 'private') return;
  
  // אם הוגדרה קבוצה ספציפית - וודא שהחיפוש מגיע ממנה בלבד
  if (db.targetGroup && String(ctx.chat.id) !== String(db.targetGroup)) return;
  
  // להתעלם מפקודות סלש (כגון /start)
  if (!ctx.message.text || ctx.message.text.startsWith('/')) return;

  const query = ctx.message.text.trim().toLowerCase();
  if (!query || db.movies.length === 0) return;

  const queryWords = query.split(/\s+/).filter(w => w.length > 0);

  // אלגוריתם התאמה חכמה
  const matchedMovies = db.movies.filter(movie => {
    return movie.aliases.some(alias => {
      if (alias.includes(query) || query.includes(alias)) return true;
      const aliasWords = alias.split(/\s+/);
      return queryWords.some(qWord => aliasWords.some(aWord => aWord.includes(qWord) || qWord.includes(aWord)));
    });
  });

  if (matchedMovies.length > 0) {
    const resultsToSend = matchedMovies.slice(0, 5); // הגבלה ל-5 תוצאות למניעת הצפה

    // הודעת פתיחה מעוצבת וממותגת בקבוצה
    const headerMsg = 
      `🎬 <b>תוצאות חיפוש עבור:</b> "${ctx.message.text}"\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🍿 נמצאו <b>${matchedMovies.length}</b> כותרים תואמים במאגר.\n` +
      `⬇️ <i>הקבצים נשלחים כעת מתחת למודעה זו:</i>`;

    try {
      await ctx.reply(headerMsg, {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.message.message_id
      });

      // שילוח נקי של הקבצים/מדיה כתגובה
      for (const movie of resultsToSend) {
        await ctx.telegram.copyMessage(ctx.chat.id, movie.from_chat_id, movie.message_id, {
          reply_to_message_id: ctx.message.message_id
        });
      }
    } catch (err) {
      console.error('❌ שגיאה בשילוח קבצים לקבוצה:', err);
    }
  }
});

// ==========================================
// 🌐 EXPRESS SERVER FOR RENDER KEEP-ALIVE
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('🍿 Movie Dispatcher Bot is Live & Operational! 🚀'));
app.listen(PORT, () => console.log(`[SERVER] Listening on port ${PORT}`));

// הפעלת הבוט ותפיסת שגיאות גלובלית
bot.launch()
  .then(() => console.log('🤖 הבוט הופעל בהצלחה ומחובר לטלגרם!'))
  .catch((err) => console.error('❌ שגיאה בהפעלת הבוט:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
