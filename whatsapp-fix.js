// whatsapp-fix.js - Fix for getContact error
module.exports = function applyWhatsAppFix() {
    const originalGetContact = require('whatsapp-web.js').Client.prototype.getContactById;
    
    require('whatsapp-web.js').Client.prototype.getContactById = async function(id) {
        try {
            return await originalGetContact.call(this, id);
        } catch (error) {
            console.log(`🛠️ Patch: getContactById failed for ${id}, returning safe contact`);
            // Return dummy contact object
            return {
                id: id,
                number: id.replace('@c.us', ''),
                name: 'User',
                pushname: 'User',
                isUser: true,
                isGroup: false,
                isWAContact: true,
                isMyContact: false
            };
        }
    };
    
    console.log('✅ WhatsApp Web.js patch applied');
};
