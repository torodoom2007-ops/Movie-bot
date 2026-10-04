require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '8017590244');
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN חסר בסביבת העבודה!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ==========================================
// 💾 מנוע אחסון נתונים בטוח (Safeguarded DB)
// ==========================================
const DB_FILE = path.join(__dirname, 'movies_db.json');

function getDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialDb = { targetGroup: null, dispatchDestination: 'group', movies: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2));
      return initialDb;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.movies) parsed.movies = [];
    if (!parsed.dispatchDestination) parsed.dispatchDestination = 'group';
    return parsed;
  } catch (e) {
    console.error('⚠️ שגיאה בקריאת קובץ הנתונים, יוצר מאגר חדש:', e.message);
    return { targetGroup: null, dispatchDestination: 'group', movies: [] };
  }
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('❌ שגיאה בשמירת נתונים:', e.message);
  }
}

let db = getDb();

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
  ['🗃️ מאגר סרטים', '➕ הוספת סרט'],
  ['⚙️ הגדרת קבוצה', '🎯 יעד שילוח סרטים'],
  ['📊 דוח סטטוס']
]).resize();

const BRAND_FOOTER = 
  `\n\n━━━━━━━━━━━━━━━━━━━━━━\n` +
  `🍿 <b>הועבר באהבה מצוות MOVIE TIME</b>\n` +
  `🔗 <a href="https://t.me/movie_time_by">לחץ כאן להצטרפות לערוץ הרשמי</a> 🍿`;

// ==========================================
// 👑 פאנל ניהול אדמין (שיחה פרטית)
// ==========================================

bot.start((ctx) => {
  if (ctx.chat.type !== 'private') return;
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔ אין לך הרשאה לגשת למערכת הניהול.');
  }
  ctx.session = {};
  return ctx.reply(
    `✨ <b>MOVIE TIME 🍿 | VIP CONTROL PANEL</b> ✨\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `שלום אדמין! המערכת פעילה, ממותגת ומוכנה לשילוח.`,
    { parse_mode: 'HTML', ...mainKeyboard }
  );
});

bot.hears('🗃️ מאגר סרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  return ctx.reply(
    `🗃️️ <b>מערכת ניהול מאגר הסרטים</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 <b>סה"כ סרטים במאגר:</b> <code>${db.movies.length}</code>\n\n` +
    `בחר את הפעולה המבוקשת:`,
    {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        ['✏️ עריכת/מחיקת סרטים'],
        ['➕ הוספת סרט', '🔙 חזרה לתפריט ראשי']
      ]).resize()
    }
  );
});

bot.hears('📊 דוח סטטוס', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;
  
  let destText = '🎯 לקבוצה בלבד';
  if (db.dispatchDestination === 'private') destText = '📩 לפרטי בלבד';
  if (db.dispatchDestination === 'both') destText = '✨ לקבוצה ולפרטי';

  return ctx.reply(
    `📊 <b>דוח סטטוס מערכת MOVIE TIME VIP:</b>\n\n` +
    `🍿 <b>כותרים במאגר:</b> <code>${db.movies.length}</code>\n` +
    `👥 <b>קבוצה מקושרת:</b> <code>${db.targetGroup || 'טרם הוגדרה'}</code>\n` +
    `🚀 <b>יעד שילוח:</b> ${destText}\n` +
    `🟢 <b>סטטוס שרת:</b> Online`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('🎯 יעד שילוח סרטים', (ctx) => {
  if (ctx.chat.type !== 'private' || !isAdmin(ctx)) return;

  return ctx.reply(
    `⚙️ <b>הגדרת יעד שילוח הסרטים בלחיצה:</b>\n` +
    `בחר לאן הבוט ישלח את הסרט כשהמשתמש לוחץ על הכפתור בקבוצה:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🎯 לקבוצה בלבד', 'set_dest_group')],
        [Markup.button.callback('📩 לפרטי של המשתמש בלבד', 'set_dest_private')],
        [Markup.button.callback('✨ גם לקבוצה וגם לפרטי', 'set_dest_both')]
      ])
    }
  );
});

bot.action(/^set_dest_(.+)$/, (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ אין הרשאה');
  const mode = ctx.match[1];
  db.dispatchDestination = mode;
  saveDb(db);

  let modeText = '🎯 לקבוצה בלבד';
  if (mode === 'private') modeText = '📩 לפרטי בלבד';
  if (mode === 'both') modeText = '✨ גם לקבוצה וגם לפרטי';

  ctx.answerCbQuery('✅ היעד עודכן!');
  return ctx.editMessageText(`✅ <b>יעד השילוח עודכן ל:</b> ${modeText}`, { parse_mode: 'HTML' });
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
    `קבוצה נוכחית: <code>${db.targetGroup || 'טרם הוגדרה'}</code>\n\n` +
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
    const title = movie.title || movie.aliases[0] || 'סרט ללא שם';
    const text = `<b>${index + 1}. ${title}</b>\n🏷️ <b>כינויים:</b> <code>${movie.aliases.join(', ')}</code>`;
    ctx.reply(text, {
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
// 📥 ADMIN WIZARD
// ==========================================
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  if (!isAdmin(ctx)) return;

  const step = ctx.session.step;
  const text = ctx.message.text;

  if (text && ['🗃️ מאגר סרטים', '➕ הוספת סרט', '⚙️ הגדרת קבוצה', '🔙 חזרה לתפריט ראשי', '✏️ עריכת/מחיקת סרטים', '📊 דוח סטטוס', '🎯 יעד שילוח סרטים'].includes(text)) {
    ctx.session.step = null;
    return next();
  }

  if (step === 'WAIT_GROUP_ID') {
    if (!text || !text.startsWith('-100')) {
      return ctx.reply('⚠️ מזהה קבוצה חייב להתחיל ב-`-100`. נסה שוב:');
    }
    db.targetGroup = text.trim();
    saveDb(db);
    ctx.session.step = null;
    return ctx.reply(`✅ <b>הקבוצה הוגדרה בהצלחה!</b>\nID: <code>${db.targetGroup}</code>`, { parse_mode: 'HTML', ...mainKeyboard });
  }

  if (step === 'WAIT_MOVIE_MEDIA') {
    ctx.session.tempMovie = {
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id
    };
    ctx.session.step = 'WAIT_MOVIE_ALIASES';
    return ctx.reply(
      `🏷️ <b>שלב 2 מתוך 2: הזנת כינויים</b>\n\n` +
      `הסרט נקלט! כעת שלח את הכינויים מופרדים בפסיקים.\n\n` +
      `<i>השם הראשון שתרשום ישמש ככותרת הראשית בכפתור.</i>\n` +
      `<i>דוגמה:</i> <code>אנגרי בירדס 1, אנגרי בירדס, angry birds 1</code>`,
      { parse_mode: 'HTML' }
    );
  }

  if (step === 'WAIT_MOVIE_ALIASES') {
    if (!text) {
      return ctx.reply('⚠️️ נא לשלוח טקסט בלבד עם הכינויים מופרדים בפסיקים.');
    }

    const rawAliases = text.split(',');
    const cleanAliases = rawAliases.map(a => a.trim()).filter(a => a.length > 0);

    if (cleanAliases.length === 0) {
      return ctx.reply('⚠️ לא הוגדרו כינויים תקינים. נסה שוב:');
    }

    const duplicates = [];
    db.movies.forEach(m => {
      m.aliases.forEach(existing => {
        cleanAliases.forEach(newA => {
          if (existing.toLowerCase() === newA.toLowerCase()) duplicates.push(newA);
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
      title: cleanAliases[0],
      from_chat_id: ctx.session.tempMovie.chat_id,
      message_id: ctx.session.tempMovie.message_id,
      aliases: cleanAliases
    };

    db.movies.push(newMovie);
    saveDb(db);

    ctx.session.step = null;
    ctx.session.tempMovie = null;

    return ctx.reply(
      `✅ <b>הסרט נשמר במאגר בהצלחה!</b>\n\n🎬 <b>כותרת:</b> ${newMovie.title}\n🏷️ <b>כינויים:</b> <code>${cleanAliases.join(' | ')}</code>`,
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
// 🔍 GROUP SEARCH ENGINE
// ==========================================

// פקודת בקשת סרט: /request שם הסרט
bot.command('request', async (ctx) => {
  if (ctx.chat.type === 'private') return;
  const reqQuery = ctx.message.text.replace('/request', '').trim();
  
  if (!reqQuery) {
    return ctx.reply('⚠️ נא לציין את שם הסרט. דוגמה:\n<code>/request אנגרי בירדס 2</code>', { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
  }

  try {
    await bot.telegram.sendMessage(
      ADMIN_ID,
      `📥 <b>בקשת סרט חדשה מהקבוצה!</b>\n━━━━━━━━━━━━━━━━━━━━━━\n👤 <b>מבקש:</b> ${ctx.from.first_name} (@${ctx.from.username || 'ללא'}) \n🎬 <b>סרט מבוקש:</b> <code>${reqQuery}</code>`,
      { parse_mode: 'HTML' }
    );
    return ctx.reply(`✅ <b>בקשתך ל-"${reqQuery}" הועברה לצוות הניהול!</b>`, { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
  } catch (err) {
    return ctx.reply('✅ הבקשה נקלטה במערכת!');
  }
});

// מנוע זיהוי חיפוש בקבוצה
bot.on('message', async (ctx, next) => {
  if (ctx.chat.type === 'private') return next();
  
  // אם הוגדרה קבוצה – לבדוק רק בה
  if (db.targetGroup && String(ctx.chat.id) !== String(db.targetGroup)) return next();
  if (!ctx.message.text || ctx.message.text.startsWith('/')) return next();

  const query = ctx.message.text.trim().toLowerCase();
  if (!query || db.movies.length === 0) return next();

  const queryWords = query.split(/\s+/).filter(w => w.length > 0);

  const matchedMovies = db.movies.filter(movie => {
    return movie.aliases.some(alias => {
      const lowerAlias = alias.toLowerCase();
      if (lowerAlias.includes(query) || query.includes(lowerAlias)) return true;
      const aliasWords = lowerAlias.split(/\s+/);
      return queryWords.some(qWord => aliasWords.some(aWord => aWord.includes(qWord) || qWord.includes(aWord)));
    });
  });

  if (matchedMovies.length > 0) {
    const results = matchedMovies.slice(0, 8);

    const inlineButtons = results.map(movie => [
      Markup.button.callback(`🍿 ${movie.title || movie.aliases[0]}`, `getmov_${movie.id}`)
    ]);

    const searchMsg = 
      `✨ <b>MOVIE TIME | VIP DISPATCHER</b> ✨\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔎 נמצאו <b>${matchedMovies.length}</b> תוצאות עבור: "<b>${ctx.message.text}</b>"\n\n` +
      `👇 <i>לחץ על הסרט המבוקש לקבלת הקובץ:</i>`;

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
// 🔘 CLICK HANDLER FOR BUTTONS
// ==========================================
bot.action(/^getmov_(.+)$/, async (ctx) => {
  const movieId = ctx.match[1];
  const movie = db.movies.find(m => m.id === movieId);

  if (!movie) {
    return ctx.answerCbQuery('❌ הסרט אינו זמין עוד במאגר.', { show_alert: true });
  }

  const dest = db.dispatchDestination || 'group';
  const userId = ctx.from.id;
  const groupChatId = ctx.chat.id;

  ctx.answerCbQuery('🍿 שולח את הסרט כעת...');

  // 1. שילוח לקבוצה
  if (dest === 'group' || dest === 'both') {
    try {
      await ctx.telegram.copyMessage(groupChatId, movie.from_chat_id, movie.message_id, {
        caption: `🎬 <b>${movie.title || movie.aliases[0]}</b>` + BRAND_FOOTER,
        parse_mode: 'HTML'
      });
    } catch (e) {
      await ctx.telegram.copyMessage(groupChatId, movie.from_chat_id, movie.message_id);
    }
  }

  // 2. שילוח לפרטי
  if (dest === 'private' || dest === 'both') {
    try {
      await ctx.telegram.copyMessage(userId, movie.from_chat_id, movie.message_id, {
        caption: `🎬 <b>${movie.title || movie.aliases[0]}</b>` + BRAND_FOOTER,
        parse_mode: 'HTML'
      });
    } catch (err) {
      if (dest === 'private') {
        try {
          const botInfo = await ctx.telegram.getMe();
          await ctx.reply(
            `👋 אהלן <a href="tg://user?id=${userId}">${ctx.from.first_name}</a>!\n` +
            `כדי לקבל את הסרט בפרטי, עליך ללחוץ על הקישור ולהפעיל אותי ראשית:\n` +
            `👉 @${botInfo.username}`,
            { parse_mode: 'HTML', reply_to_message_id: ctx.callbackQuery?.message?.message_id }
          );
        } catch (e) {}
      }
    }
  }
});

// ==========================================
// 🌐 EXPRESS SERVER FOR RENDER
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('🍿 MOVIE TIME VIP Bot is Operational! 🚀'));
app.listen(PORT, () => console.log(`[SERVER] Listening on port ${PORT}`));

bot.launch()
  .then(() => console.log('🤖 הבוט פעיל ומחובר בהצלחה!'))
  .catch((err) => console.error('❌ שגיאת הפעלה:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
