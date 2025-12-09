// routes/api.js (REPLACE ENTIRE FILE)
const express = require('express');
const User = require('../models/User');
const Request = require('../models/Request');
const shortid = require('shortid');

module.exports = function(io) {
  const router = express.Router();

  // simple register (returns created user)
  router.post('/auth/register', async (req, res) => {
    try {
      const data = req.body;
      data.userId = data.userId || shortid.generate();
      const existing = await User.findOne({ phone: data.phone });
      if (existing) return res.status(400).json({ error: 'Phone already registered' });
      const user = await User.create(data);
      io.emit('userRegistered', user);
      return res.json({ user });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'register failed' });
    }
  });

  // login (by phone)
  router.post('/auth/login', async (req, res) => {
    const { phone } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  });

  //GK: GET donors by pin
  router.get('/donors', async (req, res) => {
    try {
      const { pin, bloodType } = req.query;
      let query = {
        userRole: 'Donor',
        status: 'VERIFIED',
        pinCode: pin
      };

      if (bloodType) {
        query.bloodType = bloodType;
      }

      const donors = await User.find(query);
      return res.json({ donors });
    } catch (err) {
      console.error('get-donors error', err);
      return res.status(500).json({ error: 'get donors failed' });
    }
  });

  //GK: POST request for blood
  router.post('/request', async (req, res) => {
    try {
      const data = req.body;

      // --- CRITICAL CHANGE: ONLY ALLOW 'Hospital' ROLE TO CREATE REQUESTS ---
      if (data.userRole !== 'Hospital') {
        return res.status(403).json({ error: 'Only Hospital accounts are allowed to create blood requests.' });
      }

      // Check if a request already exists
      const existingReq = await Request.findOne({ requesterId: data.requesterId, status: 'PENDING' });
      if (existingReq) {
        return res.status(400).json({ error: 'You already have a pending request.' });
      }

      const newRequest = await Request.create(data);

      // Update the user's active request status
      await User.updateOne(
        { userId: data.requesterId },
        {
          isRequestActive: true,
          bloodTypeNeeded: data.bloodTypeNeeded,
          requestPinCode: data.pinCode,
          updatedAt: new Date(),
        }
      );
      
      if (io) io.emit('newRequest', newRequest);
      return res.json({ request: newRequest });
    } catch (err) {
      console.error('post-request error', err);
      return res.status(500).json({ error: 'post request failed' });
    }
  });

  // GK: ADMIN ROUTES
  // Admin middleware to protect routes
  const adminMiddleware = (req, res, next) => {
    const secret = req.query.adminSecret || req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };

  router.use('/admin', adminMiddleware);

  // Get users pending approval
  router.get('/admin/pending-users', async (req, res) => {
    try {
      const pendingUsers = await User.find({ status: 'PENDING_VERIFICATION' });
      return res.json({ users: pendingUsers });
    } catch (err) {
      console.error('pending-users error', err);
      return res.status(500).json({ error: 'pending users failed' });
    }
  });

  // Approve a pending user
  router.put('/admin/approve-user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findOneAndUpdate(
        { userId },
        { status: 'VERIFIED', updatedAt: new Date() },
        { new: true }
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      
      if (io) io.emit('userVerified', { userId: user.userId, status: 'VERIFIED' });
      return res.json({ user });
    } catch (err) {
      console.error('approve-user error', err);
      return res.status(500).json({ error: 'approve user failed' });
    }
  });

  // Admin route to manage request approval/denial
  router.put('/admin/approve-request/:requestId', async (req, res) => {
    try {
      const { requestId } = req.params;
      const { action } = req.body; // 'approve' or 'deny'
      const targetReq = await Request.findById(requestId);
      
      if (!targetReq) return res.status(404).json({ error: 'Request not found' });
      
      if (action === 'approve') {
        // approve
        targetReq.status = 'APPROVED';
        targetReq.updatedAt = Date.now();
        await targetReq.save();
        
        // Find all verified donors in the same pincode and emit a notification
        const matchingDonors = await User.find({
            userRole: 'Donor',
            status: 'VERIFIED',
            pinCode: targetReq.pinCode,
            bloodType: targetReq.bloodTypeNeeded
        }).select('userId'); 

        const donorIds = matchingDonors.map(d => d.userId);
        
        if (io) io.emit('requestApproved', {
            requestId: targetReq._id,
            donorIds: donorIds,
            pinCode: targetReq.pinCode,
            bloodType: targetReq.bloodTypeNeeded
        });
        
        return res.json({ request: targetReq });
      } else {
        // deny (or cancel)
        targetReq.status = 'DENIED';
        targetReq.updatedAt = Date.now();
        await targetReq.save();

        // Also deactivate the request on the User profile
        const hospitalUser = await User.findOne({ userId: targetReq.requesterId }); 
        if (hospitalUser) {
            hospitalUser.isRequestActive = false; 
            hospitalUser.bloodTypeNeeded = null; 
            hospitalUser.requestPinCode = null; 
            hospitalUser.updatedAt = new Date(); 
            await hospitalUser.save();
        }

        if (io) io.emit('requestDenied', { requestId: targetReq._id });
        return res.json({ request: targetReq });
      }
    } catch (err) {
      console.error('approve-request error', err);
      return res.status(500).json({ error: 'approve request failed' });
    }
  });

  // --- NEW: GLOBAL SYNC ENDPOINT ---
  router.get('/sync-storage', async (req, res) => {
    try {
      // 1. Get all users
      const users = await User.find({});
      // 2. Get all requests
      const requests = await Request.find({});
      // 3. Send both back
      return res.json({ users, requests });
    } catch (err) {
      console.error('sync-storage error', err);
      return res.status(500).json({ error: 'sync failed' });
    }
  });

  return router;
};