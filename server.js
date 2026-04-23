
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3000;
const PUBLIC_HOST = process.env.PUBLIC_HOST;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!PUBLIC_HOST) {
  console.error('Missing PUBLIC_HOST');
}
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.send('AI Phone Server Running 🚀');
});

app.post('/voice', (_req, res) => {
  try {
    console.log('POST /voice hit');
    console.log('PUBLIC_HOST =', PUBLIC_HOST);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://ai-phone-2s7t.onrender.com/ws"
      welcomeGreeting="Hola, te habla Valentina de JuegaPlus. ¿Te puedo hacer una pregunta rápida?"
      language="es-CL"
      welcomeGreetingInterruptible="speech"
      interruptible="speech"
      reportInputDuringAgentSpeech="speech"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      debug="debugging speaker-events"
    />
  </Connect>
</Response>

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

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  console.log('Twilio WebSocket connected');

  let callEnded = false;

  const endCall = (farewellText = 'Gracias por tu tiempo. Hasta luego.') => {
    if (callEnded) return;
    callEnded = true;

    safeSend(ws, {
      type: 'text',
      token: farewellText,
      last: true,
    });

    setTimeout(() => {
      safeSend(ws, { type: 'end' });
    }, 1000);
  };

  // 60秒自动结束（第二层保险）
  const timer = setTimeout(() => {
    console.log('Auto ending call (120s)');
    endCall('Gracias por tu tiempo. Hasta luego.');
  }, 60000);

  ws.on('close', () => {
    clearTimeout(timer);
    console.log('Twilio WebSocket disconnected');
  });

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log('WS IN:', JSON.stringify(data));

      if (callEnded) return;

      // 初始连接事件
      if (data.type === 'setup') {
  console.log('ConversationRelay setup complete');
  return;
}

      // 打断事件先忽略
      if (data.type === 'interrupt') {
        return;
      }

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
const normalized = userText.toLowerCase();

// 如果用户表达兴趣 → 直接讲 promotion
if (
  normalized.includes('sí') ||
  normalized.includes('si') ||
  normalized.includes('claro') ||
  normalized.includes('ok') ||
  normalized.includes('vale') ||
  normalized.includes('interesa')
) {
  safeSend(ws, {
    type: 'text',
    token: 'Perfecto. Actualmente podrías tener acceso a promociones activas, beneficios en recarga, free spins o campañas especiales disponibles dentro de tu cuenta de JuegaPlus. Si te interesa, puedo comunicarte con un asesor ahora mismo.',
    last: true,
  });

  return;
}

      const ai = await openai.responses.create({
  model: 'gpt-4.1-mini',
  input: [
    {
      role: 'system',
      content: `
Eres un agente telefónico de ventas de JuegaPlus.
Hablas en español chileno, natural, breve y amable.
Tu tono debe sonar humano, no robótico.

OBJETIVO DE LA LLAMADA:
1. Presentarte solo una vez.
2. Preguntar si la persona tiene interés en conocer promociones o beneficios.
3. Si la persona dice que sí o muestra interés, primero explica brevemente la promoción disponible.
4. Solo después de explicar la promoción, si la persona sigue interesada, responde exactamente: TRANSFER_HUMAN
5. Si la persona pide información por WhatsApp, responde exactamente: SEND_WHATSAPP
6. Si la persona no tiene interés, despídete de forma breve y amable.

PROMOCIÓN BASE:
Puedes mencionar algo como:
"Actualmente podrías tener acceso a promociones activas, beneficios en recarga, free spins o campañas especiales disponibles dentro de tu cuenta de JuegaPlus."

REGLAS:
- No repitas la misma pregunta dos veces seguidas.
- No vuelvas a presentarte en cada turno.
- Si la persona ya dijo que sí, no preguntes otra vez si tiene interés; pasa a explicar la promoción.
- Si la persona ya recibió una explicación y sigue interesada, responde SOLO: TRANSFER_HUMAN
- Si pide WhatsApp, responde SOLO: SEND_WHATSAPP
- Si no entiendes bien, haz una sola pregunta corta de aclaración.
- Mantén las respuestas cortas, de una o dos frases.
- No prometas ganancias.
- No expliques términos y condiciones completos.
- Si pregunta algo complejo de retiros, verificación, depósitos o problemas de cuenta, responde SOLO: TRANSFER_HUMAN
      `.trim()
    },
    {
      role: 'user',
      content: `
Estado actual:
- introDone: ${introDone}
- promotionExplained: ${promotionExplained}

Mensaje del usuario:
${userText}
      `.trim()
    }
  ]
});

const answer = ai.output_text?.trim() || 'Disculpa, ¿puedes repetirlo?';
console.log('AI answer:', answer);

// 第一次开场后，标记已介绍
if (!introDone) {
  introDone = true;
}

// 转人工
if (answer === 'TRANSFER_HUMAN') {
  endCall('Perfecto, te comunico con un asesor ahora mismo.');
  return;
}

// 发送 WhatsApp
if (answer === 'SEND_WHATSAPP') {
  endCall('Perfecto, te enviaremos la información por WhatsApp en breve.');
  return;
}

// 如果回答里已经提到了 promoción / beneficios / free spins / recarga，就认为 promotion 已介绍
if (
  answer.toLowerCase().includes('promoción') ||
  answer.toLowerCase().includes('beneficio') ||
  answer.toLowerCase().includes('free spins') ||
  answer.toLowerCase().includes('recarga')
) {
  promotionExplained = true;
}

safeSend(ws, {
  type: 'text',
  token: answer,
  last: true,
});
    } catch (err) {
      console.error('WS error:', err);
      safeSend(ws, {
        type: 'text',
        token: 'Disculpa, tuve un problema técnico. ¿Puedes repetirlo?',
        last: true,
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});