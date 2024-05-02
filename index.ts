import { REST, Routes, Client, GatewayIntentBits, Collection, Events, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import mariadb from 'mariadb';
import 'dotenv/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const database = mariadb.createPool({
    host: process.env.DATABASE_ENDPOINT,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME
});

const s3 = new S3Client({
    region: process.env.S3_REGION
});

const s3Query = (path: string) => {
    return new Promise((resolve) => {
        s3.send(new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: path
        }))
            .then((data: any) => {
                data.Body.transformToString()
                    .then((body: any) => {
                        resolve(body);
                    });
            })
            .catch((err: any) => {
                console.log(err);
                resolve(null);
            });
    })
};

const s3Create = (path: string, body: any) => {
    return new Promise<boolean>((resolve) => {
        s3.send(new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: path,
            Body: body
        }))
            .then(() => {
                resolve(true);
            })
            .catch((err: any) => {
                console.log(err);
                resolve(false);
            });
    })
}

const dbQuery = (sql: string, params: string[]) => {
    return new Promise((resolve) => {
        database.query(sql, params)
            .then((rows: any) => {
                if(rows) {
                    resolve(rows);
                }
                else {
                    resolve(null);
                }
            })
            .catch((err: any) => {
                console.log(err);
                resolve(null);
            });
    });
}

const dbQueryOne = (sql: string, params: string[]) => {
    return new Promise((resolve) => {
        database.query(sql, params)
            .then((rows: any) => {
                if(rows) {
                    resolve(rows[0]);
                }
                else {
                    resolve(null);
                }
            })
            .catch((err: any) => {
                console.log(err);
                resolve(null);
            });
    });
}

const activity = 'MasterBase';
const userRoleId = process.env.USER_ROLE_ID;
const invites = new Collection<any,any>()
const invitedUsers = new Collection<any,any>()
const maxInvitedUsers = 64

const client=new Client({intents:[
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent,
	GatewayIntentBits.GuildMembers,
	GatewayIntentBits.GuildVoiceStates,
	GatewayIntentBits.GuildInvites,
	GatewayIntentBits.GuildMessageReactions,
]})

var commands = new Collection();
commands.set("stats", {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Get stats for your user'),
    async execute(interaction: any) {
		const userId = interaction.user.id;
		const user: any = await dbQueryOne("SELECT * FROM discord_users WHERE discord_id = ?", [userId.toString()]);
		const responseCard = new EmbedBuilder()
			.setTitle("Stats of " + interaction.user.username.toString())
			.setTimestamp(new Date())
			.setColor(0x0000ff)
			.setFooter({text:"MasterBase",iconURL:interaction.guild.iconURL()})
			.setThumbnail(interaction.user.avatarURL())
			.addFields([
				{name:"Users invited",value:user.invites.toString(),inline:false},
				{name:"Messages",value:user.messages.toString(),inline:false},
				{name:"Reactions to announcements",value:user.reactions.toString(),inline:false},
				{name:"Time in voice channels",value:secondsToTime(user.seconds),inline:false},
				{name:"Level",value:scoreToLevel(user.score).toString(),inline:true},
				{name:"Score",value:user.score.toString(),inline:true}
			]);
		await interaction.reply({embeds: [responseCard]});
    }
})
commands.set("leaderboard", {
	data: new SlashCommandBuilder()
		.setName('leaderboard')
		.setDescription('Get the leaderboard'),
	async execute(interaction: any) {
		const leaderboard: any = await dbQuery("SELECT * FROM discord_users ORDER BY score DESC LIMIT 10", []);
		const responseCard = new EmbedBuilder()
			.setTitle("Leaderboard")
			.setTimestamp(new Date())
			.setColor(0x0000ff)
			.setFooter({text:"MasterBase",iconURL:interaction.guild.iconURL()})
			.setThumbnail((await client.users.fetch(leaderboard[0].discord_id.toString())).avatarURL())
			.addFields(leaderboard.map((user:any)=>{return {name:(leaderboard.indexOf(user)+1).toString() + ". " + user.discord_username,value:"Lv. " + scoreToLevel(user.score).toString() + " (Score " + user.score.toString() + ")",inline:false}}));
		await interaction.reply({embeds: [responseCard]});
	}
})

client.on(Events.ClientReady, ()=>
{
	client.guilds.cache.forEach(async(guild)=>
  	{
		const fetchedInvites = await guild.invites.fetch();
		invites.set(guild.id, new Collection(fetchedInvites.map((invite) => [invite.code,invite.uses])))
	})
	if(client.user)
  	{
		client.user.setActivity(activity, { type: 3 })
		console.log('Discord Bot Connection Successful.')
	}
	//update the score on the db based on the stats
	dbQuery("UPDATE discord_users SET score = invites*100 + messages + reactions*10 + seconds/10 + boost_bonus",[])
	/* decorateServer().then(()=>{
		console.log(serverDecorationData)
		s3Create("serverDecorationData.json",JSON.stringify(serverDecorationData))
			.then((success:boolean)=>{
				if(success) console.log("Server decoration data saved to S3.")
				else console.log("Server decoration data failed to save to S3.")
			})
	}) */
	//undecorateServer()
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
	if(member.user.bot) return
	const roleToAdd = member.guild.roles.cache.find((role:any)=>role.id == userRoleId)
	member.roles.add(roleToAdd)
	const newInvites = await member.guild.invites.fetch()
	const oldInvites = invites.get(member.guild.id)
	const invite = newInvites.find((invite:any)=>invite.uses > oldInvites.get(invite.code))
	console.log("Rewarding " + invite.inviter.id + " for inviting " + member.id + ".")
	//if inviter is boosting, give 100 bonus points
	if(member.premiumSinceTimestamp)
		dbQuery("INSERT INTO discord_users (discord_id,discord_username,invites,score,boost_bonus) VALUES (?,?,1,200,100) ON DUPLICATE KEY UPDATE invites = invites + 1, score = score + 200, boost_bonus = boost_bonus + 100",[invite.inviter.id.toString(),invite.inviter.username.toString()])
	else
		dbQuery("INSERT INTO discord_users (discord_id,discord_username,invites,score) VALUES (?,?,1,100) ON DUPLICATE KEY UPDATE invites = invites + 1, score = score + 100",[invite.inviter.id.toString(),invite.inviter.username.toString()])
	if(invitedUsers.size >= maxInvitedUsers) invitedUsers.clear()
	invitedUsers.set(member.id, invite.inviter.id)
})

client.on(Events.GuildMemberRemove, async(member:any)=>
{
	if(member.user.bot) return
	if(invitedUsers.has(member.id))
	{
		const inviter = invitedUsers.get(member.id)
		console.log("Punishing " + inviter + " for removing " + member.id + ".")
		dbQuery("UPDATE discord_users SET invites = invites - 1, score = score - 100 WHERE discord_id = ?", [inviter.toString()])
		invitedUsers.delete(member.id)
	}
})

client.on(Events.MessageCreate, async(message:any)=>
{
	if(message.author.bot) return
	console.log("Rewarding " + message.author.id + " for sending a message.")
	if(message.author.premiumSinceTimestamp)
		dbQuery("INSERT INTO discord_users (discord_id,discord_username, messages, score, boost_bonus) VALUES (?,?,1,1,1) ON DUPLICATE KEY UPDATE messages = messages + 1, score = score + 1, boost_bonus = boost_bonus + 1", [message.author.id.toString(),message.author.username.toString()])
	else
		dbQuery("INSERT INTO discord_users (discord_id,discord_username, messages, score) VALUES (?,?,1,1) ON DUPLICATE KEY UPDATE messages = messages + 1, score = score + 1", [message.author.id.toString(),message.author.username.toString()])
})

client.on(Events.MessageDelete, async(message:any)=>
{
	if(message.author.bot) return
	console.log("Punishing " + message.author.id + " for deleting a message.")
	dbQuery("UPDATE discord_users SET messages = messages - 1, score = score - 1 WHERE discord_id = ?", [message.author.id.toString()])
})

client.on(Events.MessageReactionAdd, async(reaction:any,user:any)=>
{
	if(user.bot) return
	if(reaction.message.channel.type===5)
	{
		console.log("Rewarding " + user.id + " for reacting to an announcement.")
		if(user.premiumSinceTimestamp)
			dbQuery("INSERT INTO discord_users (discord_id,discord_username, reactions, score, boost_bonus) VALUES (?,?,1,10,10) ON DUPLICATE KEY UPDATE reactions = reactions + 1, score = score + 10, boost_bonus = boost_bonus + 10", [user.id.toString(),user.username.toString()])
		else
		dbQuery("INSERT INTO discord_users (discord_id,discord_username, reactions, score) VALUES (?,?,1,10) ON DUPLICATE KEY UPDATE reactions = reactions + 1, score = score + 10", [user.id.toString(),user.username.toString()])
	}
})

client.on(Events.MessageReactionRemove, async(reaction:any,user:any)=>
{
	if(user.bot) return
	if(reaction.message.channel.type===5)
	{
		console.log("Punishing " + user.id + " for removing a reaction from an announcement.")
		dbQuery("UPDATE discord_users SET reactions = reactions - 1, score = score - 10 WHERE discord_id = ?", [user.id.toString()])
	}
})

client.on(Events.InteractionCreate, interaction => {
	if (!interaction.isCommand()) return;
	console.log(interaction);
	const command: any = commands.get(interaction.commandName);
	if (!command) return;
	try {
		command.execute(interaction);
	} catch (error) {
		console.error(error);
		interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
});

client.login(process.env.BOT_TOKEN)

const statsToScore = (invites:number, messages:number, reactions:number, seconds:number) => {
	return invites*100 + messages + reactions*10 + seconds/10;
}
const scoreToLevel = (score:number) => {
	return Math.floor(Math.sqrt(score/125))
}
const secondsToTime = (seconds:number) => {
	//format: 1 day, 2 hours, 3 minutes
	//alt format: 2 hours, 3 minutes
	const days = Math.floor(seconds/86400)
	seconds -= days*86400
	const hours = Math.floor(seconds/3600)
	seconds -= hours*3600
	const minutes = Math.floor(seconds/60)
	let time = ""
	if(days) time += days + " day" + (days>1?"s":"") + ", "
	if(hours) time += hours + " hour" + (hours>1?"s":"") + ", "
	if(minutes) time += minutes + " minute" + (minutes>1?"s":"")
	return time
}

setInterval(async function(){
	client.guilds.cache.forEach((guild)=>
	{
		guild.channels.cache.filter((channel)=>channel.type===2).forEach((channel:any)=>
		{
			if(channel.members.size) console.log("Rewarding " + channel.members.size + " members for being in a voice channel.")
			channel.members.map((member:any)=>{member.id,member.username,member.bot,member.premiumSinceTimestamp}).forEach(async(member:any)=>{
				if (member.bot) return
				if(member.premiumSinceTimestamp)
					await dbQuery("INSERT INTO discord_users (discord_id, discord_username, seconds, score, boost_bonus) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE seconds = seconds + ?, score = score + ?, boost_bonus = boost_bonus + ?",
					[member.id.toString(), member.username.toString(), Number(process.env.SIMULATION_TIME), Number(process.env.SIMULATION_TIME)/10, Number(process.env.SIMULATION_TIME)/10, Number(process.env.SIMULATION_TIME), Number(process.env.SIMULATION_TIME)/10, Number(process.env.SIMULATION_TIME)/10])
				else
					await dbQuery("INSERT INTO discord_users (discord_id, discord_username, seconds, score) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE seconds = seconds + ?, score = score + ?",
					[member.id.toString(), member.username.toString(), Number(process.env.SIMULATION_TIME), Number(process.env.SIMULATION_TIME)/10, Number(process.env.SIMULATION_TIME), Number(process.env.SIMULATION_TIME)/10])
			})
		})
	})
},Number(process.env.SIMULATION_TIME)*1000)

if(process.env.RELOADING==="true")
{
const rest = new REST().setToken(process.env.BOT_TOKEN || '');
(async () => {
	try {
		console.log('Started refreshing slash commands.');
		await rest.put(
			Routes.applicationCommands(process.env.BOT_USER_ID || ''),
			{ body: commands.map((command:any)=>command.data.toJSON()) }
		);
		console.log('Successfully reloaded slash commands.');
	} catch (error) {
		console.error(error);
	}
}
)();
}

const serverDecorationData = {
	preDecoration: {
		serverName: "",
		botNickname: "",
		channels: <any>[],
		categories: <any>[],
		nicknames: <any>[],
		roles: <any>[]
	},
	postDecoration: {
		serverName: "",
		botNickname: "",
		channels: <any>[],
		categories: <any>[],
		nicknames: <any>[],
		roles: <any>[]
	}
}

const winterHolidayEmotes = [
	"🎄",
	"🎅",
	"🤶",
	"🎁",
	"⛄",
	"🔔",
	"🍬",
	"🍭",
	"🍪",
	"🥛",
	"🧦",
	"🎆",
	"🎇",
	"🎉",
	"🎊",
	"🎈",
	"🎀",
	"🛷",
	"🦌",
	"🌟",
	"✨",
	"🧊",
]

const emoteToWinterHolidayEmote = (emote:string) => {
	const emoteCode = emote.codePointAt(0)
	if(emoteCode)
	{
		const index = emoteCode % winterHolidayEmotes.length
		return winterHolidayEmotes[index]
	}
	else
	{
		return "❓"
	}
}

const decorateSeparatedName = (channelName:string) => {
	if(channelName.indexOf("｜")===-1) return channelName
	const emote = channelName.slice(0,channelName.indexOf("｜"))
	const channelNameWithoutEmote = channelName.slice(channelName.indexOf("｜"))
	return emoteToWinterHolidayEmote(emote) + channelNameWithoutEmote
}

const decorateSpacedName = (channelName:string) => {
	const emote = channelName.slice(0,channelName.indexOf(" "))
	const channelNameWithoutEmote = channelName.slice(channelName.indexOf(" "))
	return emoteToWinterHolidayEmote(emote) + channelNameWithoutEmote
}

const decorateChannels = async() => {
	const guild = await client.guilds.fetch(process.env.BOT_GUILD_ID || '')
	await guild.channels.fetch().then(async(channels:any)=>{
		await channels.forEach(async (channel:any)=>{
			if(channel.type===4) return
			serverDecorationData.preDecoration.channels.push({id:channel.id,name:channel.name})
			serverDecorationData.postDecoration.channels.push({id:channel.id,name:decorateSeparatedName(channel.name)})
			await channel.setName(decorateSeparatedName(channel.name))
		})
	})
}

const decorateCategories = async() => {
	const guild = await client.guilds.fetch(process.env.BOT_GUILD_ID || '')
	await guild.channels.fetch().then(async (channels:any)=>{
		await channels.forEach(async (channel:any)=>{
			if(channel.type!==4) return
			serverDecorationData.preDecoration.categories.push({id:channel.id,name:channel.name})
			serverDecorationData.postDecoration.categories.push({id:channel.id,name:decorateSpacedName(channel.name)})
			await channel.setName(decorateSpacedName(channel.name))
		})
	})
}

const decorateNicknames = async() => {
	const guild = await client.guilds.fetch(process.env.BOT_GUILD_ID || '')
	await guild.members.fetch().then(async(members:any)=>{
		await members.forEach(async(member:any)=>{
			if(!member.manageable || !member.nickname || (!member.nickname.startsWith("⏬") && !member.nickname.startsWith("🎵") && !member.nickname.startsWith("🎤"))) return
			serverDecorationData.preDecoration.nicknames.push({id:member.id,name:member.nickname})
			serverDecorationData.postDecoration.nicknames.push({id:member.id,name:decorateSpacedName(member.nickname)})
			await member.setNickname(decorateSpacedName(member.nickname))
		})
	})
}

const decorateRoles = async() => {
	const guild = await client.guilds.fetch(process.env.BOT_GUILD_ID || '')
	await guild.roles.fetch().then(async(roles:any)=>{
		await roles.forEach(async(role:any)=>{
			if(!role.editable || role.name==="@everyone") return
			serverDecorationData.preDecoration.roles.push({id:role.id,name:role.name})
			serverDecorationData.postDecoration.roles.push({id:role.id,name:decorateSpacedName(role.name)})
			await role.setName(decorateSpacedName(role.name))
		})
	})
}

const decorateServer = async() => {
	await decorateChannels()
	await decorateCategories()
	await decorateNicknames()
	await decorateRoles()
	const guild = await client.guilds.fetch(process.env.BOT_GUILD_ID || '')
	serverDecorationData.preDecoration.serverName = guild.name
	serverDecorationData.postDecoration.serverName = decorateSpacedName(guild.name)
	await guild.setName(decorateSpacedName(guild.name))
	const botMember = await guild.members.fetch(process.env.BOT_USER_ID || '')
	serverDecorationData.preDecoration.botNickname = botMember.user.username
	serverDecorationData.postDecoration.botNickname = decorateSpacedName(botMember.user.username)
	await botMember.setNickname(decorateSpacedName(botMember.user.username))
}

const undecorateServer = async() => {
	const serverDecorationData: any = await s3Query("serverDecorationData.json").then((data:any)=>{
		if(data) return JSON.parse(data)
		else return null
	})
	if(!serverDecorationData) return
	const guild = await client.guilds.fetch(process.env.BOT_GUILD_ID || '')
	const botMember = await guild.members.fetch(process.env.BOT_USER_ID || '')
	serverDecorationData.preDecoration.channels.forEach((channel:any)=>{
		var fetchedChannel: any;
		const exists = guild.channels.resolve(channel.id)
		if(exists)
		{
			console.log("Channel "+channel.id+", named "+channel.name+", exists.")
			fetchedChannel = guild.channels.fetch(channel.id)
		}
		else
		{
			console.log("Channel "+channel.id+", named "+channel.name+", does not exist.")
			return
		}
		if(!fetchedChannel) return
		fetchedChannel.then((fetchedChannel:any)=>{
			console.log("Setting channel "+channel.id+" to "+channel.name+".")
			fetchedChannel.setName(channel.name)
		})
	})
	serverDecorationData.preDecoration.categories.forEach((category:any)=>{
		var fetchedCategory;
		const exists = guild.channels.resolve(category.id)
		if(exists)
		{
			fetchedCategory = guild.channels.fetch(category.id)
		}
		else
		{
			console.log("Channel "+category.id+", named "+category.name+", does not exist.")
			return
		}
		if(!fetchedCategory) return
		fetchedCategory.then((fetchedCategory:any)=>{
			console.log("Setting category "+category.id+" to "+category.name+".")
			fetchedCategory.setName(category.name)
		})
	})
	serverDecorationData.preDecoration.nicknames.forEach((nickname:any)=>{
		var fetchedMember;
		try {
			fetchedMember = guild.members.fetch(nickname.id)
		}
		catch(error) {
			console.log(error)
		}
		if(!fetchedMember) return
		fetchedMember.then((member:any)=>{
			member.setNickname(nickname.name)
		})
	})
	serverDecorationData.preDecoration.roles.forEach((role:any)=>{
		var fetchedRole;
		const exists = guild.roles.resolve(role.id)
		if(exists) {
			fetchedRole = guild.roles.fetch(role.id)
		}
		else {
			console.log("Role "+role.id+", named "+role.name+", does not exist.")
			return
		}
		if(!fetchedRole) return
		fetchedRole.then((fetchedRole:any)=>{
			if(!fetchedRole.editable || fetchedRole.name==="@everyone") return
			console.log("Setting role "+role.id+" to "+role.name+".")
			fetchedRole.setName(role.name)
		})
	})
	guild.setName(serverDecorationData.preDecoration.serverName)
	botMember.setNickname(serverDecorationData.preDecoration.botNickname)
}