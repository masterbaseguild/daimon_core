import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import mariadb from 'mariadb';
import 'dotenv/config';

const database = mariadb.createPool({
    host: process.env.DATABASE_ENDPOINT,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME
});

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
	console.log("Rewarding " + invite.inviter.id + " for inviting " + member.id + ".")
	dbQuery("INSERT INTO discord_users (id,invites) VALUES (?,1) ON DUPLICATE KEY UPDATE invites = invites + 1", [invite.inviter.id.toString()])
})

client.on(Events.MessageCreate, async(message:any)=>
{
	if(!message.author.bot)
	{
		console.log("Rewarding " + message.author.id + " for sending a message.")
		dbQuery("INSERT INTO discord_users (id, messages) VALUES (?,1) ON DUPLICATE KEY UPDATE messages = messages + 1", [message.author.id.toString()])
	}
})

/* client.on(Events.MessageReactionAdd, async(reaction:any,user:any)=>
{
	if(!user.bot)
	{
		console.log("Rewarding " + user.id + " for reacting to a message.")
		dbQuery("INSERT INTO discord_users (id, reactions) VALUES (?,1) ON DUPLICATE KEY UPDATE reactions = reactions + 1", [user.id.toString()])
	}
})

client.on(Events.MessageReactionRemove, async(reaction:any,user:any)=>
{
	if(!user.bot)
	{
		console.log("Punishing " + user.id + " for removing a reaction from a message.")
		dbQuery("UPDATE discord_users SET reactions = reactions - 1 WHERE id = ?", [user.id.toString()])
	}
}) */

client.login(process.env.BOT_TOKEN)

setInterval(async function(){
	client.guilds.cache.forEach((guild)=>
	{
		guild.channels.cache.filter((channel)=>channel.type===2).forEach((channel:any)=>
		{
			channel.members.map((member:any)=>member.id).forEach(async(member:any)=>await dbQueryOne("UPDATE discord_users SET minutes = minutes + ? WHERE id = ? ON DUPLICATE KEY UPDATE minutes = minutes + ?",
			[Number(process.env.SIMULATION_TIME), member.toString(), Number(process.env.SIMULATION_TIME)]))
		})
	})
},Number(process.env.SIMULATION_TIME)*1000)