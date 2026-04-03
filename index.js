
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('@discordjs/builders');
const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
const cron = require('node-cron');
dotenv.config();

const client = new Client({ 
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
});

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Liberty Valley Roleplay Bot is alive!'));
app.listen(port, () => console.log(`Server on port ${port}`));

// Constants
const SESSION_FEATURE_CHANNEL = '1475673336381177960';
const LOG_CHANNEL = '1489446890411130942';
const VOTERS_CHANNEL = '1434195493382127688';
const STAFF_ROLE = '1434618549791363272';
const STAFF_ROLES = ['1434197420991844528', '1489387863819681935', '1434197433168035890', '1479856722796613733', '1476318904618844204', '1434197451056873512', '1434197453124669510', '1434197454349402112', '1434197518924779562'];
const AVATAR = 'https://cdn.discordapp.com/attachments/1489444813836390580/1489444844324524103/3521_1.png';
const USERNAME = 'LVRPC Sessions';
const VOTER_ROLE = '1472590455739777137';

let sessionState = {
  active: false,
  starter: null,
  startTime: null,
  voteTarget: 0,
  voteMsgId: null,
  voters: new Set(),
  lowAlertSent: false,
  checkTimeout: null,
  cooldownUntil: 0
};

client.once('ready', async () => {
  console.log(`${client.user.tag} Liberty Valley Roleplay Community is online!`);
  
  // Register slash command
  const commands = [new SlashCommandBuilder().setName('sessions').setDescription('Session management panel').toJSON()];
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  
  try {
    const guildId = client.guilds.cache.first().id;
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
    console.log('Slash command registered');
  } catch (error) {
    console.error('Slash command error:', error);
  }
  
  await logStatus('Session Inactive');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.channel.id !== SESSION_FEATURE_CHANNEL) return;
  
  if (message.content === '*sessions') {
    await handleSessionsCommand(message);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'sessions') {
    await handleSessionsCommand(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  }
});

async function handleSessionsCommand(interaction) {
  const member = interaction.member;
  
  if (!hasStaffRole(member)) {
    const reply = await interaction.reply({ content: `<:LVRPC:1489435879645646858> <@${interaction.user.id}>: You are not permitted to use this command, as you are not a Junior Administrator or above on the staff-team. Please try again later!`, ephemeral: true });
    setTimeout(() => reply.delete().catch(() => {}), 10000);
    return;
  }
  
  if (Date.now() < sessionState.cooldownUntil) {
    const timeLeft = Math.ceil((sessionState.cooldownUntil - Date.now()) / 60000);
    await interaction.reply({ content: `Cooldown active. Wait ${timeLeft} min(s).`, ephemeral: true });
    return;
  }
  
  await interaction.deferReply({ ephemeral: false });
  
  if (sessionState.active) {
    await sendActivePanel(interaction);
  } else {
    await sendInactivePanel(interaction);
  }
}

function hasStaffRole(member) {
  return STAFF_ROLES.some(roleId => member.roles.cache.has(roleId));
}

async function sendInactivePanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('𝐒𝐞𝐬𝐬𝐢𝐨𝐧 𝐌𝐚𝐧𝐚𝐠𝐞𝐦𝐞𝐧𝐭 𝐏𝐚𝐧𝐞𝐥・𝐋𝐕𝐑𝐏𝐂')
    .setDescription(`Welcome to the Session Management Panel <:LVRPC:1489435879645646858>, <@${interaction.user.id}>!\n\n- As you are Junior Administrator+, you have the ability to configure sessions accordingly. Please refer below for more information:\n**Session Status: Inactive 🔴**\n\`Shutdown By:\` N/A\n\`Shutdown At:\` N/A\n\`Shutdown Reason:\` N/A\n**Session Configuration 🛠️**\n\`1.\` Initiate a Session Vote\n\`2.\` Start a New Session`)
    .setColor(0xFF0000)
    .setThumbnail(AVATAR);
  
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('p_287052346217730060')
    .setPlaceholder('Select a Session Configuration Option')
    .addOptions([
      { label: '1. Initiate a Session Vote', value: 'vote' },
      { label: '2. Start a New Session', value: 'start', emoji: '🎮' }
    ]);
  
  const row = new ActionRowBuilder().addComponents(selectMenu);
  
  await interaction.editReply({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
  
  const filter = i => i.user.id === interaction.user.id;
  const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });
  
  collector.on('collect', async i => {
    await i.deferUpdate();
    if (i.customId === 'p_287052346217730060') {
      sessionState.starter = interaction.user;
      if (i.values[0] === 'vote') {
        await handleVoteInitiate(i);
      } else if (i.values[0] === 'start') {
        await handleDirectStart(i);
      }
    }
  });
  
  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });
}

async function handleVoteInitiate(interaction) {
  const dmChannel = await interaction.user.createDM();
  await dmChannel.send('**Question:** How many votes would you like the session vote to receive before a session begins? (Reply with ONLY a number).');
  
  const filter = m => m.author.id === interaction.user.id;
  const collector = dmChannel.createMessageCollector({ filter, time: 300000 });
  
  collector.on('collect', async msg => {
    const num = parseInt(msg.content);
    if (!isNaN(num) && num > 0 && num <= 50) {
      sessionState.voteTarget = num;
      collector.stop('success');
      await handleVoteMessage(interaction.user, SESSION_FEATURE_CHANNEL);
    } else {
      msg.reply('Please reply with a valid number (1-50).').catch(() => {});
    }
  });
  
  collector.on('end', (collected, reason) => {
    if (reason !== 'success') {
      interaction.followUp({ content: 'Vote setup timed out or invalid.', ephemeral: true });
    }
  });
}

async function handleVoteMessage(user, channelId) {
  const channel = client.channels.cache.get(channelId);
  await clearChannel(channel);
  
  const embed = new EmbedBuilder()
    .setTitle('Session Vote')
    .setDescription(`A session vote has been conducted by <@${user.id}>. To participate in the session, ensure that you vote with ✅ below to count your vote!\n**Current Votes:** \`0/${sessionState.voteTarget}\``)
    .setColor(0x0000FF);
  
  const voteMsg = await channel.send({ content: `<@&${VOTER_ROLE}>`, embeds: [embed] });
  
  await voteMsg.react('✅');
  
  sessionState.voteMsgId = voteMsg.id;
  
  pollVotes(voteMsg);
  
  const dmChannel = await user.createDM();
  dmChannel.send('**Question:** Would you like to begin the session? Reply with "Yes".');
  
  const filter = m => m.author.id === user.id;
  const collector = dmChannel.createMessageCollector({ filter, time: 300000 });
  
  collector.on('collect', async msg => {
    if (msg.content.toLowerCase() === 'yes') {
      sessionState.active = true;
      sessionState.startTime = Date.now();
      await logStatus('Session Active');
      await handleSessionStart(channel);
      collector.stop();
    } else {
      msg.reply('Reply "Yes" to start.').catch(() => {});
    }
  });
  
  collector.on('end', () => {
    if (sessionState.active) return;
    // Cancel vote if no yes
    voteMsg.delete().catch(() => {});
  });
}

async function clearChannel(channel) {
  let fetched;
  do {
    fetched = await channel.messages.fetch({ limit: 100 });
    const toDelete = fetched.filter(m => !m.pinned && !m.author.bot);
    await channel.bulkDelete(toDelete, true).catch(() => {});
  } while (fetched.size >= 100);
}

async function pollVotes(voteMsg) {
  const pollInterval = setInterval(async () => {
    try {
      const msg = await voteMsg.channel.messages.fetch(voteMsg.id);
      const reaction = msg.reactions.cache.get('✅');
      const users = await reaction.users.fetch();
      const count = users.filter(u => !u.bot).size;
      
      const newDesc = msg.embeds[0].description.replace(/Current Votes: \`[^`]+\`/ , `Current Votes: \`${count}/${sessionState.voteTarget}\``);
      const embed = EmbedBuilder.from(msg.embeds[0]).setDescription(newDesc);
      
      await msg.edit({ embeds: [embed] });
      
      if (count >= sessionState.voteTarget) {
        clearInterval(pollInterval);
        sessionState.voters = new Set(users.filter(u => !u.bot).keys());
        // Trigger start prompt already in handleVoteMessage
      }
    } catch (e) {
      clearInterval(pollInterval);
    }
  }, 3000);
}

async function handleSessionStart(channel) {
  const embed = await getSessionStartEmbed();
  const startMsg = await channel.send({ content: `<@&${VOTER_ROLE}>`, embeds: [embed] });
  
  // Voters notification
  const votersMentions = Array.from(sessionState.voters).slice(0, 10).map(id => `<@${id}>`).join('\n> - ');
  const votersChannel = client.channels.cache.get(VOTERS_CHANNEL);
  await votersChannel.send({
    content: `**Session Management**\n\`\`\`As you have voted in-game, you must join in the next 15 minutes or you will face punishment.\`\`\`\n**Session Voters** -> Head to <#${SESSION_FEATURE_CHANNEL}> for Information!\n> - ${votersMentions}`,
    allowedMentions: { parse: ['users'] }
  });
  
  // Delete vote msg
  client.channels.cache.get(SESSION_FEATURE_CHANNEL).messages.delete(sessionState.voteMsgId).catch(() => {});
  
  // Update embed every 5 mins
  cron.schedule('*/5 * * * *', async () => {
    if (sessionState.active && startMsg.editable) {
      const newEmbed = await getSessionStartEmbed();
      await startMsg.edit({ embeds: [newEmbed] });
    }
  });
  
  startSessionMonitors();
}

async function getSessionStartEmbed() {
  const players = await getPlayerCount();
  const staff = await getStaffCount();
  
  return new EmbedBuilder()
    .setTitle('Session Started!')
    .setDescription(`A session has officially began after enough votes!\nVoters notified in <#${VOTERS_CHANNEL}>.\n\n**In-Game:** \`${players}/39\`\n**In-Queue:** \`LVRPCOGG\`\n**Staff On-Duty:** \`${staff}\``)
    .setColor(0x00FF00);
}

async function getPlayerCount() {
  try {
    const res = await axios.get('https://api.policeroleplay.community/v1/server/players', {
      headers: { Authorization: `Bearer ${process.env.ERLC_API_KEY}` }
    });
    return res.data.players ? res.data.players.length : 0;
  } catch (error) {
    console.error('ERLC API error:', error.message);
    return 'API Error';
  }
}

async function getStaffCount() {
  const guild = client.guilds.cache.first();
  if (!guild) return 0;
  const role = guild.roles.cache.get(STAFF_ROLE);
  return role ? role.members.cache.size : 0;
}

function startSessionMonitors() {
  // Low player alert every min
  cron.schedule('0 * * * * *', async () => { // every min
    if (!sessionState.active) return;
    const players = await getPlayerCount();
    if (players < 6 && !sessionState.lowAlertSent) {
      sessionState.starter.send('The session is running low (<6 players). Use *sessions to boost.').catch(() => {});
      sessionState.lowAlertSent = true;
      const channel = client.channels.cache.get(SESSION_FEATURE_CHANNEL);
      channel.send({
        content: `@here <@&${VOTER_ROLE}>`,
        embeds: [new EmbedBuilder()
          .setTitle('Session Boost Needed')
          .setDescription('The session is running low on players. Please join (code: `LVRPCOGG`)!')
          .setColor(0xFFA500)]
      });
    } else if (players >= 6) {
      sessionState.lowAlertSent = false;
    }
    
    if (players >= 39) {
      const channel = client.channels.cache.get(SESSION_FEATURE_CHANNEL);
      channel.send('**Session Full!** There may be a queue in-game.');
    }
  });
  
  // 2hr shutdown check
  sessionState.checkTimeout = setTimeout(handleSessionCheck, 7200000);
}

async function handleSessionCheck() {
  if (!sessionState.starter) return;
  
  const dmChannel = await sessionState.starter.createDM();
  dmChannel.send('**Session Check (2hr):** Is the session still running? Reply "Yes" or "No" within 1 hour.');
  
  const filter = m => m.author.id === sessionState.starter.id;
  const collector = dmChannel.createMessageCollector({ filter, time: 3600000 });
  
  collector.on('collect', async msg => {
    if (msg.content.toLowerCase() === 'yes') {
      startSessionMonitors(); // Reset timer
    } else {
      await shutdownSession('Starter');
    }
    collector.stop();
  });
  
  collector.on('end', () => {
    if (sessionState.active) {
      // Fallback to mod role
      const guild = client.guilds.cache.first();
      const modRole = guild.roles.cache.get('1479856722796613733');
      if (modRole && modRole.members.size > 0) {
        const mod = modRole.members.first();
        const modDM = mod.createDM().catch(() => {});\n        if (modDM) modDM.send('**Fallback Session Check:** Reply "Yes" to continue, else shutdown.').catch(() => {});
        // Simplified: auto shutdown after 10min
        setTimeout(() => shutdownSession('Fallback timeout'), 600000);
      } else {
        shutdownSession('No response');
      }
    }
  });
}

async function shutdownSession(reason) {
  sessionState.active = false;
  sessionState.cooldownUntil = Date.now() + 3600000; // 1hr cooldown
  await logStatus(`Session Inactive - Reason: ${reason}`);
  
  clearTimeout(sessionState.checkTimeout);
  sessionState.lowAlertSent = false;
  
  const channel = client.channels.cache.get(SESSION_FEATURE_CHANNEL);
  const embed = new EmbedBuilder()
    .setTitle('Session Shutdown')
    .setDescription('A session has been shutdown. Thank you for joining!')
    .setColor(0x808080);
  channel.send({ embeds: [embed] });
}

// Stub functions for completeness
async function handleSelectMenu(interaction) {}
async function handleButton(interaction) {}
async function handleDirectStart(interaction) {
  interaction.followUp({ content: 'Direct start not implemented yet.', ephemeral: true });
}

async function logStatus(status) {
  const channel = client.channels.cache.get(LOG_CHANNEL);
  if (channel) {
    await channel.send(`**Session Status:** ${status}`);
  }
}

client.on('error', console.error);
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

client.login(process.env.DISCORD_TOKEN);

