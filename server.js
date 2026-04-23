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
  try {
    console.log('POST /voice hit');
    console.log('PUBLIC_HOST =', process.env.PUBLIC_HOST);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://${process.env.PUBLIC_HOST}/ws"
      welcomeGreeting="Hola, te habla JuegaPlus. ¿Te puedo hacer una pregunta rápida?"
    />
  </Connect>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
  } catch (err) {
    console.error('/voice error:', err);
    res.status(500).send('voice route failed');
  }
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
  console.log('Twilio WebSocket connected');

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log('WS IN:', JSON.stringify(data));

      // Twilio ConversationRelay 会先发 setup
      if (data.type === 'setup') {
        return;
      }

      // 用户讲话后的主要事件
      const userText =
        data.voicePrompt ||
        data.prompt ||
        data.text ||
        '';

      if (!userText) {
        console.log('No user text found in message');
        return;
      }

      console.log('User said:', userText);

      const ai = await openai.responses.create({
  model: 'gpt-4.1-mini',
  input: [
    {
      role: 'system',
      content: `
Eres un agente telefónico de ventas de JuegaPlus.
Hablas en español chileno, natural, breve y amable.
Tu tono debe sonar humano, no robótico.

OBJETIVO:
1. Presentarte brevemente.
2. Confirmar si la persona tiene interés en conocer promociones o beneficios disponibles.
3. Si la persona muestra interés claro, responde exactamente con la palabra: TRANSFER_HUMAN
4. Si la persona pide información por WhatsApp, responde exactamente con la palabra: SEND_WHATSAPP
5. Si la persona no tiene interés, despídete de forma breve y amable.
6. Si la persona no entiende, repite con otras palabras, pero siempre breve.

REGLAS:
- No des respuestas largas.
- No expliques términos y condiciones completos.
- No prometas ganancias.
- No hables como soporte técnico.
- No inventes promociones específicas si no te las preguntan.
- No uses lenguaje agresivo ni insistente.
- Si la persona está ocupada, ofrece volver a contactar más tarde o enviar WhatsApp.
- Si la persona pregunta algo complejo sobre retiros, verificación, depósitos o problemas de cuenta, responde exactamente: TRANSFER_HUMAN
- Siempre intenta mantener la conversación corta.

GUION BASE:
- Saludo inicial:
  "Hola, te habla Valentina de JuegaPlus. Te llamo muy breve para comentarte que podrías tener beneficios o promociones disponibles. ¿Te interesa que te cuente rápidamente?"
- Si dice sí / claro / dime / ok:
  Responde exactamente: TRANSFER_HUMAN
- Si dice WhatsApp / mándame la info / envíamelo:
  Responde exactamente: SEND_WHATSAPP
- Si dice no / no me interesa / no gracias:
  "Perfecto, gracias por tu tiempo. Que tengas un buen día."
- Si dice ahora no puedo:
  "Entiendo. Si quieres, podemos contactarte más tarde o enviarte la información por WhatsApp."
- Si no se entiende:
  "Disculpa, solo quería comentarte que podrías tener beneficios disponibles en JuegaPlus. ¿Te interesa recibir información?"

IMPORTANTE:
- Cuando debas transferir a una persona, responde SOLO: TRANSFER_HUMAN
- Cuando debas enviar WhatsApp, responde SOLO: SEND_WHATSAPP
- En cualquier otra situación, responde en español chileno y en una sola frase breve.
      `.trim()
    },
    {
      role: 'user',
      content: userText
    }
  ]
});

      const answer = ai.output_text?.trim() || 'Disculpa, ¿puedes repetirlo?';
console.log('AI answer:', answer);

// 转人工
if (answer === 'TRANSFER_HUMAN') {
  ws.send(JSON.stringify({
    type: 'text',
    token: 'Perfecto, te comunico con un asesor ahora mismo.',
    last: true
  }));

  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'end'
    }));
  }, 1200);

  return;
}

// 发送 WhatsApp
if (answer === 'SEND_WHATSAPP') {
  ws.send(JSON.stringify({
    type: 'text',
    token: 'Perfecto, te enviaremos la información por WhatsApp en breve.',
    last: true
  }));

  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'end'
    }));
  }, 1200);

  return;
}

// 正常回复
ws.send(JSON.stringify({
  type: 'text',
  token: answer,
  last: true
}));

  ws.on('close', () => {
    console.log('Twilio WebSocket disconnected');
  });
});

server.listen(process.env.PORT || 3000);