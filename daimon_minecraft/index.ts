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

// each tick, defined in the environment variable,
// - for each faction, calculate the power
// - add said power to the power integral

setInterval(async function(){
    console.log('Running simulation');
	const factions: any = await dbQuery('SELECT * FROM minecraft.mf_faction', []);
    console.log("Factions");
    console.log(factions);
    factions.forEach(async (faction: any) => {
        const players: any = await dbQuery('SELECT * FROM minecraft.mf_faction_member JOIN minecraft.mf_player ON minecraft.mf_faction_member.player_id = minecraft.mf_player.id WHERE faction_id = ?', [faction.id]);
        console.log("Players for faction " + faction.name);
        console.log(players);
        let power = faction.bonus_power;
        players.forEach((player: any) => {
            power += player.power;
        });
        if(power < 0) power = 0;
        console.log("Power for faction " + faction.name + ": " + power)
        await dbQuery('INSERT INTO minecraft_factions (mf_id, power_integral, score) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE score = power_integral + ?, power_integral = power_integral + ?', [faction.id, power, power, power, power]);
    })
    const players: any = await dbQuery('SELECT * FROM minecraft.zs__player', []);
    // from the minecraft.zs__stats table, for each player, get the following stat rows: DAMAGE_DEALT, MOB_KILLS, PLAYER_KILLS, PLAY_ONE_MINUTE,
    // AVIATE_ONE_CM, BOAT_ONE_CM, CROUCH_ONE_CM, FLY_ONE_CM, HORSE_ONE_CM, MINECART_ONE_CM, PIG_ONE_CM, SPRINT_ONE_CM, STRIDER_ONE_CM, SWIM_ONE_CM, WALK_ONE_CM,
    // z:mined, z:crafted, z:placed
    // add to minecraft_players.score the following:
    // sum of ONE_CM stats / 7500
    // PLAY_ONE_MINUTE / 200
    // MOB_KILLS * 10
    // PLAYER_KILLS * 100
    // DAMAGE_DEALT * 5
    // sum z: stats / 25
    players.forEach(async (player: any) => {
        const stats: any = await dbQuery('SELECT * FROM minecraft.zs__stats WHERE uuid = ?', [player.uuid]);
        let score = 0;
        stats.forEach((stat: any) => {
            switch(stat.stat) {
                case 'DAMAGE_DEALT':
                    score += Number(stat.val) * 5;
                    break;
                case 'MOB_KILLS':
                    score += Number(stat.val) * 10;
                    break;
                case 'PLAYER_KILLS':
                    score += Number(stat.val) * 100;
                    break;
                case 'PLAY_ONE_MINUTE':
                    score += Number(stat.val) / 200;
                    break;
                case 'AVIATE_ONE_CM':
                case 'BOAT_ONE_CM':
                case 'CROUCH_ONE_CM':
                case 'FLY_ONE_CM':
                case 'HORSE_ONE_CM':
                case 'MINECART_ONE_CM':
                case 'PIG_ONE_CM':
                case 'SPRINT_ONE_CM':
                case 'STRIDER_ONE_CM':
                case 'SWIM_ONE_CM':
                case 'WALK_ONE_CM':
                    score += Number(stat.val) / 7500;
                    break;
                case 'z:mined':
                case 'z:crafted':
                case 'z:placed':
                    score += Number(stat.val) / 25;
                    break;
                default:
                    break;
            }
        });
        // set the score to integer
        score = Math.floor(score);
        await dbQuery('INSERT INTO minecraft_players (minecraft_username, score) VALUES (?, ?) ON DUPLICATE KEY UPDATE score = score + ?', [player.name, score, score]);
    });
},Number(process.env.SIMULATION_TIME)*15*1000)