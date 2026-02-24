require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT;

var mysql = require('mysql');

var pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DBHOST,
  user: process.env.DBUSER,
  password: process.env.DBPASS,
  database: process.env.DBNAME
});

app.use(cors());
app.use(express.json());
app.set('view engine', 'ejs');


/**
 * accounts endpoint
 * 
 * transactions endpoint
 * 
 * results endpoint 
 */

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});