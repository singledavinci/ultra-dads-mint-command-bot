import axios from 'axios';

export interface TelegramConfig {
    botToken: string;
    personalId: string;
    groupId: string;
    enabled: boolean;
}

export class TelegramService {
    private token: string;
    private personalId: string;
    private groupId: string;

    constructor(config: TelegramConfig) {
        this.token = config.botToken;
        this.personalId = config.personalId;
        this.groupId = config.groupId;
    }

    private async sendMessage(chatId: string, text: string) {
        if (!this.token || !chatId) return;
        const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
        try {
            await axios.post(url, {
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: false,
            });
        } catch (error) {
            console.error('Error sending Telegram message:', error);
        }
    }

    async sendPersonalNotification(message: string) {
        await this.sendMessage(this.personalId, `🔔 <b>Personal Alert</b>\n\n${message}`);
    }

    async sendGroupAnnouncement(data: {
        projectName: string;
        contractAddress: string;
        supply?: string;
        price: string;
        from: string;
    }) {
        const etherscan = `https://etherscan.io/token/${data.contractAddress}`;
        const blur = `https://blur.io/collection/${data.contractAddress}`;
        const openseaPro = `https://pro.opensea.io/collection/${data.contractAddress}`;

        const text = `
🚀 <b>NEW MINT DETECTED!</b>

📦 <b>Project:</b> ${data.projectName}
🔢 <b>Supply:</b> ${data.supply || 'Unknown'}
💰 <b>Price:</b> ${data.price} ETH
👤 <b>Minter:</b> <code>${data.from}</code>

🔗 <a href="${etherscan}">Etherscan</a> | <a href="${blur}">Blur</a> | <a href="${openseaPro}">OpenSea Pro</a>
    `.trim();

        await this.sendMessage(this.groupId, text);
    }
}
