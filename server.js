import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import twilio from 'twilio';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const VoiceResponse = twilio.twiml.VoiceResponse;

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('AI Phone Server Running 🚀');
});

app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();

  const connect = twiml.connect();
  connect.conversationRelay({
    url: `wss://${process.env.PUBLIC_HOST}/ws`,
    welcomeGreeting: 'Hola, te habla JuegaPlus. ¿Te puedo hacer una pregunta rápida?'
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  ws.on('message', async (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.type === 'prompt') {
      const userText = data.voicePrompt || '';

      const ai = await openai.responses.create({
        model: 'gpt-4.1-mini',
        input: `Responde en español: ${userText}`
      });

      ws.send(JSON.stringify({
        type: 'text',
        token: ai.output_text,
        last: true
      }));
    }
  });
});

server.listen(3000);