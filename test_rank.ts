import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/leaderboard/season1');
        const data = await res.json();

        const wallet = "0x9daA4E94fB1498CE351dbcc93ec2f1F6211E10eF"; // Example local wallet

        let rankIdx = -1;
        if (data && data.leaderboard) {
            rankIdx = data.leaderboard.findIndex((u: any) => u.wallet_address.toLowerCase() === wallet.toLowerCase());
        }

        console.log(`Rank Index for ${wallet}:`, rankIdx);
        console.log('Leaderboard:', data.leaderboard?.slice(0, 3));
    } catch (e) {
        console.error(e);
    }
}
test();
