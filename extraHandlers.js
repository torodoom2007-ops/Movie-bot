// ==========================================
// 🛡️ MOVIE TIME VIP - ADVANCED GROUP SECURITY & CONTENT
// שכבת ניהול: הגנת ספאם, סינון קישורים והודעות ברכה
// ==========================================

module.exports = function registerExtraHandlers(bot, db, saveDb) {

  // מנגנון מעקב נתונים נגד ספאם (In-Memory Map)
  const userMsgTracker = new Map(); // userId -> array of timestamps

  // בדיקה האם המשתמש הוא מנהל בקבוצה
  async function isUserAdmin(ctx) {
    if (ctx.chat.type === 'private') return true;
    try {
      const chatAdmins = await ctx.getChatAdministrators();
      return chatAdmins.some(admin => admin.user.id === ctx.from.id);
    } catch (e) {
      return false;
    }
  }

  // בדיקה האם ההודעה מכילה קישור (Text / Entities)
  function containsLink(ctx) {
    const text = ctx.message?.text || ctx.message?.caption || '';
    const hasLinkEntity = ctx.message?.entities?.some(e => e.type === 'url' || e.type === 'text_link') ||
                          ctx.message?.caption_entities?.some(e => e.type === 'url' || e.type === 'text_link');
    const linkRegex = /(https?:\/\/|t\.me\/|www\.|telegram\.me\/)/i;
    return hasLinkEntity || linkRegex.test(text);
  }

  // ==========================================
  // 1. הודעת ברכה מושקעת לחברים חדשים
  // ==========================================
  bot.on('new_chat_members', async (ctx) => {
    if (ctx.chat.type === 'private') return;

    for (const member of ctx.message.new_chat_members) {
      if (member.is_bot) continue; // התעלמות מבוטים חדשים

      const welcomeText = 
        `🍿 <b>ברוך/ה הבא/ה ${member.first_name} לקבוצת MOVIE TIME!</b> ✨\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎬 <b>איך מוצאים סרט בקבוצה?</b>\n` +
        `פשוט רושמים את שם הסרט בצ'אט (למשל: <code>אנגרי בירדס</code>).\n\n` +
        `📥 <b>רוצה לבקש סרט שלא קיים במאגר?</b>\n` +
        `רשום בצ'אט: <code>/request שם הסרט</code>\n\n` +
        `🚫 <b>חוקי הקבוצה:</b>\n` +
        `• פרסום קישורים מכל סוג שהוא אסור בהחלט!\n` +
        `• הצפה של הצ'אט תגרום להשתקה אוטומטית.\n\n` +
        `🔔 <b>להצטרפות לערוץ העדכונים הרשמי:</b>\n` +
        `👉 <a href="https://t.me/movie_time_by">Movie Time Channel</a>`;

      try {
        await ctx.reply(welcomeText, { 
          parse_mode: 'HTML',
          disable_web_page_preview: true 
        });
      } catch (e) {
        console.error('שגיאה בשליחת הודעת ברוכים הבאים:', e.message);
      }
    }
  });

  // ==========================================
  // 2. שכבת סינון הודעות: Anti-Spam + Link Blocker
  // ==========================================
  bot.on('message', async (ctx, next) => {
    if (ctx.chat.type === 'private') return next();
    if (!ctx.from) return next();

    const userId = ctx.from.id;

    // א. בדיקת מנהל - מנהלים והבוט פטורים מסינון קישורים וספאם
    const isAdmin = await isUserAdmin(ctx);
    if (isAdmin) {
      return next(); // מאפשר למנהל להמשיך ללא הגבלות
    }

    // ב. הגנת ספאם (שיטפון): מעל 10 הודעות ב-5 שניות
    const now = Date.now();
    const timestamps = userMsgTracker.get(userId) || [];
    const recentTimestamps = timestamps.filter(t => now - t < 5000); // 5 שניות אחרונות
    recentTimestamps.push(now);
    userMsgTracker.set(userId, recentTimestamps);

    if (recentTimestamps.length > 10) {
      try {
        // מחיקת ההודעה שהציפה
        await ctx.deleteMessage();

        // השתקת המשתמש לשעה (3600 שניות)
        await ctx.restrictChatMember(userId, {
          permissions: { can_send_messages: false },
          until_date: Math.floor(Date.now() / 1000) + 3600
        });

        // ניקוי המעקב עבורו
        userMsgTracker.delete(userId);

        const muteNotice = await ctx.reply(
          `⚠️ <b>השתקה אוטומטית!</b>\n` +
          `<a href="tg://user?id=${userId}">${ctx.from.first_name}</a> הושתק/ה לשעה עקב הצפה (Spam/Flood).`,
          { parse_mode: 'HTML' }
        );

        // מחיקת הודעת ההשתקה אחרי 15 שניות לשמירה על צ'אט נקי
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, muteNotice.message_id).catch(() => {}), 15000);
        return; 
      } catch (e) {
        console.error('שגיאה בהשתקת משתמש מציף:', e.message);
      }
    }

    // ג. חסימת קישורים (רק למשתמשים רגילים)
    if (containsLink(ctx)) {
      try {
        await ctx.deleteMessage();

        const warnMsg = await ctx.reply(
          `🚫 <a href="tg://user?id=${userId}">${ctx.from.first_name}</a>, שליחת קישורים בקבוצה מותרת למנהלים בלבד!`,
          { parse_mode: 'HTML' }
        );

        // מחיקת הודעת האזהרה אחרי 10 שניות
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, warnMsg.message_id).catch(() => {}), 10000);
        return; // עוצר את הטיפול בהודעה ולא מעביר למנוע החיפוש
      } catch (e) {
        console.error('שגיאה במחיקת הודעה עם קישור:', e.message);
      }
    }

    // אם ההודעה תקינה, ממשיכים הלאה למנוע החיפוש ב-index.js
    return next();
  });

};
