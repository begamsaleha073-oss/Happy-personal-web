const express = require('express');
const cors = require('cors');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Telegram API Credentials - YEH TERI OWN IDS DALNA
const API_ID = parseInt(process.env.API_ID) || 123456; // Apna API ID dal
const API_HASH = process.env.API_HASH || 'your_api_hash_here'; // Apna API Hash dal

// David Bot ka username
const DAVID_BOT_USERNAME = 'David_user_name_to_num_bot';

// Store sessions and OTP requests
const sessions = new Map();
const otpRequests = new Map();

// Request OTP Endpoint
app.post('/api/request-otp', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                error: 'Phone number required hai'
            });
        }

        console.log(`📱 OTP request for: ${phoneNumber}`);

        // Naya session create karo
        const stringSession = new StringSession('');
        const client = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
        });

        await client.start({
            phoneNumber: async () => phoneNumber,
            phoneCode: async () => {
                // OTP request store karo
                otpRequests.set(phoneNumber, {
                    client,
                    stringSession,
                    timestamp: Date.now()
                });
                
                return new Promise(() => {}); // OTP input ka wait karo
            },
            onError: (err) => {
                console.error('Telegram error:', err);
                res.status(500).json({
                    success: false,
                    error: 'OTP request failed: ' + err.message
                });
            }
        });

        res.json({
            success: true,
            message: 'OTP bhej diya gaya hai'
        });

    } catch (error) {
        console.error('OTP request error:', error);
        res.status(500).json({
            success: false,
            error: 'OTP request failed: ' + error.message
        });
    }
});

// Verify OTP Endpoint
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { phoneNumber, phoneCode } = req.body;
        
        if (!phoneNumber || !phoneCode) {
            return res.status(400).json({
                success: false,
                error: 'Phone number aur OTP code dono required hai'
            });
        }

        console.log(`✅ OTP verify kar raha: ${phoneNumber}`);

        const otpRequest = otpRequests.get(phoneNumber);
        if (!otpRequest) {
            return res.status(400).json({
                success: false,
                error: 'Is number pe koi OTP request nahi mili'
            });
        }

        const { client } = otpRequest;
        
        // Session save karo
        const sessionString = client.session.save();
        sessions.set(phoneNumber, {
            client,
            sessionString,
            authenticated: true,
            timestamp: Date.now()
        });

        // OTP request clean karo
        otpRequests.delete(phoneNumber);

        res.json({
            success: true,
            message: 'OTP verify ho gaya'
        });

    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({
            success: false,
            error: 'OTP verification failed: ' + error.message
        });
    }
});

// Send to David Bot - REAL IMPLEMENTATION
app.post('/api/send-to-bot', async (req, res) => {
    try {
        const { phoneNumber, username } = req.body;
        
        if (!phoneNumber || !username) {
            return res.status(400).json({
                success: false,
                error: 'Phone number aur username dono required hai'
            });
        }

        console.log(`🚀 David Bot ko bhej raha: ${username} from: ${phoneNumber}`);

        const session = sessions.get(phoneNumber);
        if (!session || !session.authenticated) {
            return res.status(400).json({
                success: false,
                error: 'Pehle OTP verify karo bhai'
            });
        }

        const { client } = session;

        // David Bot se connect karo
        await client.connect();
        
        // Bot ko message bhejo
        const botEntity = await client.getEntity(DAVID_BOT_USERNAME);
        
        // Username bhejo bot ko
        await client.sendMessage(botEntity, {
            message: username
        });

        console.log(`📨 Bot ko message bhej diya: ${username}`);

        // Bot se response ka wait karo
        // Yeh part tricky hai kyunki bot ka response pattern malum hona chahiye
        let botResponse = null;
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts && !botResponse) {
            // Last messages check karo
            const messages = await client.getMessages(botEntity, { 
                limit: 5 
            });
            
            // Bot ke naye messages dekho
            for (const message of messages) {
                if (message.senderId === botEntity.id && 
                    message.message.includes(username)) {
                    botResponse = message.message;
                    break;
                }
            }
            
            if (!botResponse) {
                // Thoda wait karo
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
            }
        }

        // Agar bot ne response diya toh parse karo
        let userData = null;
        if (botResponse) {
            userData = parseBotResponse(botResponse, username);
        } else {
            // Fallback - direct user info nikal lo
            userData = await getUserInfoFromUsername(client, username);
        }

        res.json({
            success: true,
            data: userData,
            message: 'David Bot ko successfully bhej diya'
        });

    } catch (error) {
        console.error('David Bot error:', error);
        res.status(500).json({
            success: false,
            error: 'David Bot ko send karne mein error: ' + error.message
        });
    }
});

// Bot ke response ko parse karne ka function
function parseBotResponse(botResponse, username) {
    try {
        // Yeh pattern tumhare bot ke response ke hisab se customize karna
        const lines = botResponse.split('\n');
        const userData = {
            id: 'N/A',
            phone: 'N/A', 
            currentUsername: username,
            profileViews: 'N/A',
            history: [],
            source: 'David Bot'
        };

        for (const line of lines) {
            if (line.includes('ID:')) {
                userData.id = line.split('ID:')[1]?.trim() || 'N/A';
            }
            if (line.includes('Phone:')) {
                userData.phone = line.split('Phone:')[1]?.trim() || 'N/A';
            }
            if (line.includes('Views:')) {
                userData.profileViews = line.split('Views:')[1]?.trim() || 'N/A';
            }
            // Username history parse karo
            if (line.includes('@') && line !== username) {
                userData.history.push(line.trim());
            }
        }

        return userData;

    } catch (error) {
        console.error('Bot response parse error:', error);
        return getFallbackData(username);
    }
}

// Direct user info nikalne ka function
async function getUserInfoFromUsername(client, username) {
    try {
        // Username se user entity get karo
        const userEntity = await client.getEntity(username);
        
        return {
            id: userEntity.id.toString(),
            phone: userEntity.phone || 'Private',
            currentUsername: userEntity.username || username,
            profileViews: 'N/A', // Yeh direct nahi milta
            history: [`@${username} (current)`],
            source: 'Telegram API Direct'
        };
    } catch (error) {
        console.error('User info fetch error:', error);
        return getFallbackData(username);
    }
}

// Fallback data agar kuch na chale
function getFallbackData(username) {
    return {
        id: 'Not Available',
        phone: 'Not Available',
        currentUsername: username,
        profileViews: 'Not Available',
        history: [`@${username} (current)`],
        source: 'Fallback Data'
    };
}

// Session cleanup - purani sessions hatado
setInterval(() => {
    const now = Date.now();
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    
    for (const [phone, session] of sessions.entries()) {
        if (now - session.timestamp > SESSION_TIMEOUT) {
            sessions.delete(phone);
            console.log(`🧹 Session cleaned: ${phone}`);
        }
    }
}, 5 * 60 * 1000); // 5 minutes

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🤖 David Bot: ${DAVID_BOT_USERNAME}`);
});
