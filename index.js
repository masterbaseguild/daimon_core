const Discord = require('discord.js');
const { Client } = Discord;
const { GoogleTTS } = require('@google-cloud/text-to-speech');
require('dotenv').config();

const client = new Client();
const prefix = '!'; // Customize this with your desired command prefix

client.on('message', async (message) => {
  // Ignore messages from other bots
  if (message.author.bot) return;

  // Check if the message starts with the specified prefix
  if (message.content.startsWith(prefix)) {
    const command = message.content.slice(prefix.length).trim().split(' ');
    const cmd = command.shift().toLowerCase();

    // Check if the command is !tts
    if (cmd === 'tts') {
      // Join the command arguments into a string
      const textToSpeak = command.join(' ');

      // Check if the user is in a voice channel
      if (message.member.voice.channel) {
        const connection = await message.member.voice.channel.join();

        // Create a Google Text-to-Speech instance
        const gtts = new GoogleTTS(textToSpeak, 'en');

        // Save the TTS audio as a file
        const audioFile = 'tts.mp3';
        gtts.save(audioFile, async () => {
          // Play the TTS audio in the voice channel
          const dispatcher = connection.play(audioFile);

          // Handle when the audio finishes playing
          dispatcher.on('finish', () => {
            connection.disconnect();
          });
        });
      } else {
        message.reply('You need to be in a voice channel to use this command!');
      }
    }
  }
});

// Log in to Discord using the bot token
client.login(process.env.BOT_TOKEN);