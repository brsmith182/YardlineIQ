const express = require('express');
const Pick = require('../models/Pick');
const User = require('../models/User');
const router = express.Router();

// Create new pick
router.post('/create-pick', async (req, res) => {
  try {
    const { week, game, pick, confidence, pickType, gameTime, analysis } = req.body;

    const newPick = new Pick({
      week: parseInt(week),
      game,
      pick,
      confidence,
      pickType,
      gameTime: new Date(gameTime),
      analysis
    });

    await newPick.save();

    res.json({ message: 'Pick created successfully!', pick: newPick });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create pick' });
  }
});

// Get admin stats
router.get('/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const paidUsers = await User.countDocuments({ 
      subscription: { $ne: 'free' },
      subscriptionEnd: { $gt: new Date() }
    });
    const totalPicks = await Pick.countDocuments();
    
    const picks = await Pick.find({ result: { $ne: 'pending' } });
    const wonPicks = picks.filter(pick => pick.result === 'win').length;
    const winRate = picks.length > 0 ? ((wonPicks / picks.length) * 100).toFixed(1) + '%' : '61%';

    res.json({
      totalUsers,
      paidUsers,
      totalPicks,
      winRate
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// Get all users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('email firstName lastName subscription subscriptionEnd createdAt lastLogin')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Update pick result
router.put('/update-pick/:id', async (req, res) => {
  try {
    const { result } = req.body;
    const pick = await Pick.findByIdAndUpdate(
      req.params.id,
      { result },
      { new: true }
    );

    if (!pick) {
      return res.status(404).json({ error: 'Pick not found' });
    }

    res.json({ message: 'Pick updated successfully!', pick });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update pick' });
  }
});

module.exports = router;
