const express = require('express');
const { createClient } = require('redis');
const router = express.Router();

// Initialize Redis client
let redisClient;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL
    });
    
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    await redisClient.connect();
  }
  return redisClient;
}

// Handle free pick email signup
router.post('/free-pick', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    
    const client = await getRedisClient();
    const emailLower = email.toLowerCase();
    const timestamp = Date.now();
    
    const emailEntry = {
      email: emailLower,
      signupDate: new Date().toISOString(),
      timestamp: timestamp,
      type: 'free_pick'
    };
    
    // Store individual email
    await client.set(`email:${emailLower}`, JSON.stringify(emailEntry));
    
    // Add to list of all emails
    await client.sAdd('all_emails', emailLower);
    
    console.log(`Email saved to Redis: ${email}`);
    
    res.json({ 
      success: true,
      message: 'You have been successfully registered for this week\'s Free Pick! Email will be sent out prior to the game. Thank you and Good Luck!'
    });
    
  } catch (error) {
    console.error('Redis email save error:', error);
    res.status(500).json({ 
      error: 'Failed to save email',
      details: error.message 
    });
  }
});

// Save subscriber (for payments)
async function saveSubscriber(customerData) {
  try {
    const client = await getRedisClient();
    const email = customerData.email.toLowerCase();
    
    const subscriberData = {
      ...customerData,
      timestamp: Date.now(),
      signupDate: new Date().toISOString(),
      type: 'paid_subscriber'
    };
    
    // Store individual subscriber
    await client.set(`subscriber:${email}`, JSON.stringify(subscriberData));
    
    // Add to list of all subscribers
    await client.sAdd('all_subscribers', email);
    
    console.log(`Subscriber saved to Redis: ${email}`);
    return { success: true };
    
  } catch (error) {
    console.error('Redis subscriber save error:', error);
    return { success: false, error: error.message };
  }
}

// Get all emails for admin
async function getAllEmails() {
  try {
    const client = await getRedisClient();
    const emailList = await client.sMembers('all_emails');
    const emails = [];
    
    for (const email of emailList) {
      const emailData = await client.get(`email:${email}`);
      if (emailData) {
        emails.push(JSON.parse(emailData));
      }
    }
    
    return emails;
  } catch (error) {
    console.error('Redis email retrieval error:', error);
    return [];
  }
}

// Get all subscribers for admin
async function getAllSubscribers() {
  try {
    const client = await getRedisClient();
    const subscriberList = await client.sMembers('all_subscribers');
    const subscribers = [];
    
    for (const email of subscriberList) {
      const subscriberData = await client.get(`subscriber:${email}`);
      if (subscriberData) {
        subscribers.push(JSON.parse(subscriberData));
      }
    }
    
    return subscribers;
  } catch (error) {
    console.error('Redis subscriber retrieval error:', error);
    return [];
  }
}

// Admin route to get all data
router.get('/admin/users', async (req, res) => {
  try {
    const emails = await getAllEmails();
    const subscribers = await getAllSubscribers();
    
    res.json({
      emails: emails,
      subscribers: subscribers,
      counts: {
        total_emails: emails.length,
        total_subscribers: subscribers.length
      }
    });
    
  } catch (error) {
    console.error('Admin data retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
});

module.exports = {
  router,
  saveSubscriber,
  getAllEmails,
  getAllSubscribers
};
