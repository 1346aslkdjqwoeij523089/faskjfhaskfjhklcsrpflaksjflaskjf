const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
require('dotenv').config();

// Discord Bot
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', c => {
  console.log(`${c.user.tag} Liberty Valley Roleplay Community is online!`);
});

client.login(process.env.DISCORD_TOKEN);

// Express for UptimeRobot
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.status(200).send('Liberty Valley Roleplay Bot is alive!');
});

app.listen(port, () => {
  console.log('HTTP server on port ' + port + ' for UptimeRobot');
});

// Error handling to stay online
process.on('uncaughtException', err => console.error('Uncaught:', err));
process.on('unhandledRejection', reason => console.error('Unhandled:', reason));
