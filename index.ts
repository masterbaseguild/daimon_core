import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import GoogleTTS from '@google-cloud/text-to-speech';
import 'dotenv/config';

const activity = 'MasterBase';
const userRoleId = process.env.USER_ROLE_ID;
const ttsTextChannelId = process.env.TTS_TEXT_CHANNEL_ID || '';
const ttsVoiceChannelId = process.env.TTS_VOICE_CHANNEL_ID || '';
const invites = new Collection<any,any>()

const client=new Client({intents:[
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent,
	GatewayIntentBits.GuildMembers,
	GatewayIntentBits.GuildVoiceStates,
	GatewayIntentBits.GuildInvites
]})

client.on(Events.ClientReady, ()=>
{
	client.guilds.cache.forEach(async(guild)=>
  	{
		const fetchedInvites = await guild.invites.fetch();
		invites.set(guild.id, new Collection(fetchedInvites.map((invite) => [invite.code,invite.uses])))
	})
	if(client.user)
  	{
		client.user.setActivity(activity)
		console.log('Discord Bot Connection Successful.')
	}
})

client.on(Events.InviteCreate, (invite:any)=>
{
	const guildInvites = invites.get(invite.guild.id)
	if(guildInvites) guildInvites.set(invite.code, invite.uses)
})

client.on(Events.InviteDelete, (invite:any)=>
{
	const guildInvites = invites.get(invite.guild.id)
	if(guildInvites) guildInvites.delete(invite.code)
})

client.on(Events.GuildMemberAdd, async(member:any)=>
{
	const roleToAdd = member.guild.roles.cache.find((role:any)=>role.id == userRoleId)
	member.roles.add(roleToAdd)
	const newInvites = await member.guild.invites.fetch()
	const oldInvites = invites.get(member.guild.id)
	const invite = newInvites.find((invite:any)=>invite.uses > oldInvites.get(invite.code))
	console.log("rewarding " + invite.inviter.id + " for inviting " + member.toString())
})

client.on(Events.MessageCreate, async(message:any)=>
{
	if(!message.author.bot)
	{
		console.log("rewarding " + message.author.id + " for sending a message")
		//if message is in tts channel use tts
		if(message.channel.id == ttsTextChannelId)
		{
			//join voice channel
			const voiceChannel = client.channels.cache.get(ttsVoiceChannelId);
			if(voiceChannel)
			{
				const connection = await voiceChannel.join();
				const ttsClient = new GoogleTTS.TextToSpeechClient();
				const request = {
					input: {text: message.content},
					voice: {languageCode: 'en-US', ssmlGender: 'NEUTRAL'},
					audioConfig: {audioEncoding: 'MP3'},
				};
				const [response] = await ttsClient.synthesizeSpeech(request);
				const buffer = response.audioContent;
				connection.play(buffer);
			}
		}
	}
})

client.login(process.env.BOT_TOKEN)