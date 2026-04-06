const express = require('express');
const router = express.Router();
const { pool } = require('../db/init');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/profile
router.get('/', authenticate, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT user_id, name, email, role, location, phone, created_at FROM users WHERE user_id = ?', [req.user.user_id]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const user = users[0];
        let profile = {};

        if (user.role === 'employee') {
            const [profiles] = await pool.query('SELECT * FROM employee_profiles WHERE user_id = ?', [user.user_id]);
            if (profiles.length > 0) profile = profiles[0];
        } else if (user.role === 'employer') {
            const [profiles] = await pool.query('SELECT * FROM employer_profiles WHERE user_id = ?', [user.user_id]);
            if (profiles.length > 0) profile = profiles[0];
        }

        res.json({ user, profile });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/profile
router.put('/', authenticate, async (req, res) => {
    try {
        const { name, phone, location, skills, experience, education, resume_url, availability } = req.body;
        
        // Update users table fields
        if (name) await pool.query('UPDATE users SET name = ? WHERE user_id = ?', [name, req.user.user_id]);
        if (phone) await pool.query('UPDATE users SET phone = ? WHERE user_id = ?', [phone, req.user.user_id]);
        if (location) await pool.query('UPDATE users SET location = ? WHERE user_id = ?', [location, req.user.user_id]);

        if (req.user.role === 'employee') {
            const [existing] = await pool.query('SELECT * FROM employee_profiles WHERE user_id = ?', [req.user.user_id]);
            if (existing.length > 0) {
                const ex = existing[0];
                await pool.query(
                    'UPDATE employee_profiles SET skills=?, experience=?, education=?, resume_url=?, availability=? WHERE user_id=?',
                    [
                        skills || ex.skills || '', 
                        experience || ex.experience || 0, 
                        education || ex.education || '', 
                        resume_url || ex.resume_url || '', 
                        availability || ex.availability || 'both', 
                        req.user.user_id
                    ]
                );
            } else {
                await pool.query(
                    'INSERT INTO employee_profiles (user_id, skills, experience, education, resume_url, availability) VALUES (?, ?, ?, ?, ?, ?)',
                    [req.user.user_id, skills || '', experience || 0, education || '', resume_url || '', availability || 'both']
                );
            }
        }

        // Fetch updated data
        const [users] = await pool.query('SELECT user_id, name, email, role, location, phone FROM users WHERE user_id = ?', [req.user.user_id]);
        const [profiles] = await pool.query('SELECT * FROM employee_profiles WHERE user_id = ?', [req.user.user_id]);
        
        res.json({ 
            user: users[0], 
            profile: profiles.length > 0 ? profiles[0] : {}, 
            message: 'Profile updated successfully' 
        });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/profile/employer
router.put('/employer', authenticate, requireRole('employer'), async (req, res) => {
    try {
        const { name, phone, location, company_name, company_description, company_location, company_website, industry } = req.body;
        
        if (name) await pool.query('UPDATE users SET name = ? WHERE user_id = ?', [name, req.user.user_id]);
        if (phone) await pool.query('UPDATE users SET phone = ? WHERE user_id = ?', [phone, req.user.user_id]);
        if (location) await pool.query('UPDATE users SET location = ? WHERE user_id = ?', [location, req.user.user_id]);

        const [existing] = await pool.query('SELECT * FROM employer_profiles WHERE user_id = ?', [req.user.user_id]);
        if (existing.length > 0) {
            const ex = existing[0];
            await pool.query(
                'UPDATE employer_profiles SET company_name=?, company_description=?, company_location=?, company_website=?, industry=? WHERE user_id=?',
                [
                    company_name || ex.company_name || '', 
                    company_description || ex.company_description || '',
                    company_location || ex.company_location || '', 
                    company_website || ex.company_website || '',
                    industry || ex.industry || '',
                    req.user.user_id
                ]
            );
        } else {
             await pool.query(
                'INSERT INTO employer_profiles (user_id, company_name, company_description, company_location, company_website, industry) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    req.user.user_id,
                    company_name || name || '', 
                    company_description || '',
                    company_location || location || '', 
                    company_website || '',
                    industry || ''
                ]
            );
        }

        const [users] = await pool.query('SELECT user_id, name, email, role, location, phone FROM users WHERE user_id = ?', [req.user.user_id]);
        const [profiles] = await pool.query('SELECT * FROM employer_profiles WHERE user_id = ?', [req.user.user_id]);
        
        res.json({ 
            user: users[0], 
            profile: profiles.length > 0 ? profiles[0] : {}, 
            message: 'Employer profile updated successfully' 
        });
    } catch (err) {
        console.error('Update employer profile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/profile/public/:userId — public profile for any user (authenticated)
router.get('/public/:userId', authenticate, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID: ' + req.params.userId });

        const [users] = await pool.query('SELECT user_id, name, role, location, created_at FROM users WHERE user_id = ?', [userId]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found (ID: ' + userId + ')' });

        const user = users[0];
        let profile = {};

        if (user.role === 'employer') {
            const [profiles] = await pool.query('SELECT company_name, company_description, company_location, industry, company_website FROM employer_profiles WHERE user_id = ?', [userId]);
            if (profiles.length > 0) profile = profiles[0];
        } else {
            const [profiles] = await pool.query('SELECT skills, experience, education, availability FROM employee_profiles WHERE user_id = ?', [userId]);
            if (profiles.length > 0) profile = profiles[0];
        }

        // Get active jobs if employer
        let jobs = [];
        if (user.role === 'employer') {
            const [jobRows] = await pool.query(`SELECT j.job_id, j.title, j.location, j.salary, j.job_type, j.job_date, j.end_date, j.start_time, j.end_time, j.status, jc.category_name
                FROM jobs j
                LEFT JOIN job_category_mapping jcm ON j.job_id = jcm.job_id
                LEFT JOIN job_categories jc ON jcm.category_id = jc.category_id
                WHERE j.employer_id = ? AND j.status = 'open' ORDER BY j.created_at DESC`, [userId]);
            jobs = jobRows;
        }

        res.json({ user, profile, jobs });
    } catch (err) {
        console.error('Get public profile error:', err.message, err.stack);
        res.status(500).json({ error: 'Failed to load profile. Database error: ' + err.message });
    }
});

module.exports = router;
