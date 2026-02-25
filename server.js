require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT;
const ejs = require('ejs');
var mysql = require('mysql2/promise');
const axios = require('axios');

const serverURL = `http://localhost:${port}`;

var pool = mysql.createPool({
	connectionLimit: 10,
	host: process.env.DBHOST,
	user: process.env.DBUSER,
	password: process.env.DBPASS,
	database: process.env.DBNAME
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('views', './views');
app.set('view engine', 'ejs');

/* ---------------------------------------
*   Accounts endpoints
* ------------------------------------------ 
*/

//GET all accounts
app.get('/api/accounts', async (req, res) => {
	try {
		const [rows] = await pool.query('SELECT * FROM accounts');
		res.status(200).json(rows);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

//GET a single account
app.get('/api/accounts/:id', async (req, res) => {
	const accountId = req.params.id;
	try {
		const [rows] = await pool.query('SELECT * FROM accounts WHERE id = ?', [accountId]);
		if (rows.length === 0) {
			return res.status(404).json({ error: 'Account not found' });
		}
		res.status(200).json(rows[0]);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

//POST create a new account
app.post('/api/accounts', async (req, res) => {
	try {
		const { owner, balance } = req.body;

		if (!owner || balance === undefined) {
			return res.status(400).json({ error: 'Owner and balance are required' });
		}
		const [result] = await pool.query('INSERT INTO accounts (owner, balance) VALUES (?, ?)', [owner, balance]);

		const newAccount = { id: result.insertId, owner, balance };

		res.status(201).json(newAccount);

	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

//PATCH update an existing account
app.patch('/api/accounts/:id', async (req, res) => {
	try {
		const { owner, balance } = req.body
		const fields = []
		const values = []

		if (owner !== undefined) {
			fields.push('owner = ?');
			values.push(owner);
		}
		if (balance !== undefined) {
			fields.push('balance = ?');
			values.push(balance);
		}

		if (fields.length === 0) {
			return res.status(400).json({ error: 'At least one field is required' });
		}

		values.push(req.params.id);
		const [result] = await pool.query(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`, values);
		if (result.affectedRows === 0) {
			return res.status(404).json({ error: 'Account not found' });
		}
		res.status(200).send({ message: 'Account updated successfully' });

	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

//DELETE an existing account
app.delete('/api/accounts/:id', async (req, res) => {
	try {
		const accountId = req.params.id;
		const [result] = await pool.query('DELETE FROM accounts WHERE id = ?', [accountId]);
		if (result.affectedRows === 0) {
			return res.status(404).json({ error: 'Account not found' });
		}
		res.status(204).send({ message: 'Account deleted successfully' });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

/* ---------------------------------------
*   Transactions endpoints
* ------------------------------------------ 
*   POST /transactions
*      body: from_account_id, to_account_id, amount
*
*   szabályok:
*   - from_account_id és to_account_id nem lehet ugyanaz -> rollback
*    - ha nincs from_account_id vagy to_account_id -> rollback
*    - ha from_account_id balance < amount -> rollback (nincs pénz)
*    - ha bármi hiba -> rollback
*    - ha minden rendben -> commit
*/


app.post('/api/transactions', async (req, res) => {
	const { from_account_id, to_account_id, amount } = req.body;

	if (from_account_id === to_account_id) {
		return res.status(400).json({ error: 'Invalid transaction: from_account_id and to_account_id must be different' });
	}

	if (!from_account_id || !to_account_id || amount === undefined) {
		return res.status(400).json({ error: 'Invalid transaction: from_account_id, to_account_id and amount are required' });
	}

	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();

		//check if from_account exists and has enough balance
		const [fromRows] = await connection.query('SELECT * FROM accounts WHERE id = ?', [from_account_id]);
		if (fromRows.length === 0) {
			throw new Error('From account not found');
		}
		if (fromRows[0].balance < amount) {
			throw new Error('Insufficient funds in from account');
		}

		//check if to_account exists
		const [toRows] = await connection.query('SELECT * FROM accounts WHERE id = ?', [to_account_id]);
		if (toRows.length === 0) {
			throw new Error('To account not found');
		}

		//perform the transaction
		await connection.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [amount, from_account_id]);
		await connection.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, to_account_id]);

		//insert transaction record
		const [result] = await connection.query('INSERT INTO transfers (from_acc, to_acc, amount) VALUES (?, ?, ?)', [from_account_id, to_account_id, amount]);

		await connection.commit();
		return res.status(201).json({ message: "Transaction successful" });

	} catch (error) {
		console.error(error);
		connection.rollback();
		connection.release();
		return res.status(500).json({ error: 'Internal Server Error' });
	} finally {
		connection.release();
	}

});

//GET transactions

app.get('/api/transactions', async (req, res) => {
	try {
		const [rows] = await pool.query('SELECT * FROM transfers INNER JOIN accounts AS from_acc ON transfers.from_acc = from_acc.id INNER JOIN accounts AS to_acc ON transfers.to_acc = to_acc.id');
		res.status(200).json(rows);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

//GET transaction by id

app.get('/api/transactions/:id', async (req, res) => {
	const transactionId = req.params.id;
	try {
		const [rows] = await pool.query('SELECT * FROM transfers INNER JOIN accounts AS from_acc ON transfers.from_acc = from_acc.id INNER JOIN accounts AS to_acc ON transfers.to_acc = to_acc.id WHERE transfers.id = ?', [transactionId]);
		if (rows.length === 0) {
			return res.status(404).json({ error: 'Transaction not found' });
		}
		res.status(200).json(rows[0]);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

/*
 * results endpoint 
 */

app.get('/', async (req, res) => {
	res.redirect('/results')
});

app.get('/results', async (req, res) => {
	try {
		const accountsRes = await axios.get(`${serverURL}/api/accounts`);
		const transactionsRes = await axios.get(`${serverURL}/api/transactions`);

		const accounts = accountsRes.data;
		const transactions = transactionsRes.data;

		res.render('index', { accounts, transactions });

	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

app.get('/accounts', async (req, res) => {
	res.render('accounts')
});

app.post('/accounts', async (req, res) => {
	const { owner, balance } = req.body;

	try {
		await axios.post(`${serverURL}/api/accounts`, { owner, balance });
		res.redirect('/results');
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});

app.get('/transactions', async (req, res) => {
	const accounts = await axios.get(`${serverURL}/api/accounts`);
	res.render('transactions', { accounts: accounts.data });
});

app.post('/transactions', async (req, res) => {
	const { from_account_id, to_account_id, amount } = req.body;

	try {
		await axios.post(`${serverURL}/api/transactions`, { from_account_id, to_account_id, amount });
		res.redirect('/results');
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Internal Server Error' });
	}
});


app.listen(port, () => {
	console.log(`Server running on port ${port}`);
});