import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
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

    // 先用最简 ConversationRelay，优先确认 /ws 能连上
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
  url="wss://${PUBLIC_HOST}/ws"
  welcomeGreeting="Hola, te habla Valentina de JuegaPlus. ¿Te puedo hacer una pregunta rápida?"
  language="es-CL"
  transcriptionProvider="Deepgram"
  speechModel="nova-3-general"
  ttsProvider="ElevenLabs"
  voice="Bella"
  interruptible="speech"
/>
  </Connect>
</Response>`;

    console.log('TWIML OUT:', twiml);

    res.type('text/xml');
    res.send(twiml);
  } catch (err) {
    console.error('/voice error:', err);
    res.status(500).send('voice route failed');
  }
});

server.on('upgrade', (request, socket, head) => {
  console.log('UPGRADE HIT:', request.url);

  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    console.log('UPGRADE REJECTED:', request.url);
    socket.destroy();
  }
});

function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function extractUserText(data) {
  return (
    data.voicePrompt ||
    data.prompt ||
    data.text ||
    data.speech ||
    data.transcript ||
    data.utterance ||
    data.message ||
    ''
  ).trim();
}

function isPositiveReply(text) {
  const normalized = text.toLowerCase();
  return (
    normalized === 'sí' ||
    normalized === 'si' ||
    normalized.includes('sí') ||
    normalized.includes('si') ||
    normalized.includes('claro') ||
    normalized.includes('dale') ||
    normalized.includes('bueno') ||
    normalized.includes('ok') ||
    normalized.includes('vale') ||
    normalized.includes('dime') ||
    normalized.includes('cuéntame') ||
    normalized.includes('interesa')
  );
}

function isNegativeReply(text) {
  const normalized = text.toLowerCase();
  return (
    normalized === 'no' ||
    normalized.includes('no gracias') ||
    normalized.includes('no me interesa') ||
    normalized.includes('ahora no') ||
    normalized.includes('después') ||
    normalized.includes('ocupado') ||
    normalized.includes('ocupada') ||
    normalized.includes('no quiero')
  );
}

function soundsUnclear(text) {
  const normalized = text.toLowerCase().trim();
  return (
    normalized.length <= 1 ||
    normalized === 'ah' ||
    normalized === 'eh' ||
    normalized === 'mm' ||
    normalized === 'mmm' ||
    normalized === 'hola'
  );
}

wss.on('connection', (ws, request) => {
  console.log('Twilio WebSocket connected:', request?.url);

  let promotionExplained = false;
  let clarificationCount = 0;
  let callEnded = false;

  const endCall = (farewellText = 'Gracias por tu tiempo. Hasta luego.') => {
    if (callEnded) return;
    callEnded = true;

    console.log('Ending call with:', farewellText);

    safeSend(ws, {
      type: 'text',
      token: farewellText,
      last: true,
    });

    setTimeout(() => {
      safeSend(ws, { type: 'end' });
    }, 1000);
  };

  const timer = setTimeout(() => {
    console.log('Auto ending call after 120 seconds');
    endCall('Gracias por tu tiempo. Hasta luego.');
  }, 120000);

  ws.on('close', () => {
    clearTimeout(timer);
    console.log('Twilio WebSocket disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('message', async (msg) => {
    try {
      const raw = msg.toString();
      console.log('RAW WS MESSAGE:', raw);

      const data = JSON.parse(raw);
      console.log('WS IN:', JSON.stringify(data));

      if (callEnded) return;

      if (data.type === 'setup') {
        console.log('Ignoring setup event');
        return;
      }

      if (data.type === 'interrupt') {
        console.log('Ignoring interrupt event');
        return;
      }

      const userText = extractUserText(data);

      if (!userText) {
        console.log('No user text extracted from event:', data.type);
        return;
      }

      console.log('User said:', userText);

      if (isNegativeReply(userText)) {
        endCall('Entiendo, muchas gracias por tu tiempo. Que estés muy bien.');
        return;
      }

      if (!promotionExplained && isPositiveReply(userText)) {
        promotionExplained = true;

        safeSend(ws, {
          type: 'text',
          token: 'Perfecto. Actualmente podrías tener acceso a promociones activas, beneficios en recarga, free spins o campañas especiales disponibles dentro de tu cuenta de JuegaPlus. Si te interesa, puedo comunicarte con un asesor ahora mismo.',
          last: true,
        });

        return;
      }

      if (soundsUnclear(userText) && clarificationCount < 1) {
        clarificationCount += 1;

        safeSend(ws, {
          type: 'text',
          token: 'Claro. Te cuento súper breve: podrías tener promociones o beneficios disponibles en tu cuenta. ¿Te interesa que te explique en unos segundos?',
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
Hablas en español chileno, natural, breve, amable y muy humano.

CONTEXTO:
- La bienvenida inicial ya fue dada por el sistema.
- NO te presentes de nuevo.
- NO repitas literalmente la pregunta inicial si el usuario ya respondió.

OBJETIVO:
1. Continuar la conversación de forma breve.
2. Si el usuario quiere detalles, explica brevemente la promoción.
3. Si después de escuchar la promoción sigue interesado en saber más o hablar con alguien, responde SOLO: TRANSFER_HUMAN
4. Si pide WhatsApp, responde SOLO: SEND_WHATSAPP
5. Si el usuario claramente no tiene interés, responde con una despedida breve y amable en español.
6. Si el mensaje del usuario es ambiguo, corto o poco claro, haz una sola pregunta corta de aclaración y NO cierres la llamada.

PROMOCIÓN BASE:
"Actualmente podrías tener acceso a promociones activas, beneficios en recarga, free spins o campañas especiales disponibles dentro de tu cuenta de JuegaPlus."

REGLAS:
- Respuestas cortas.
- No prometas ganancias.
- No uses lenguaje robótico.
- No cierres la llamada salvo que el usuario deje claro que no le interesa.
- Si pregunta algo complejo, responde SOLO: TRANSFER_HUMAN
            `.trim(),
          },
          {
            role: 'user',
            content: `
Estado actual:
- promotionExplained: ${promotionExplained}
- clarificationCount: ${clarificationCount}

Mensaje del usuario:
${userText}
            `.trim(),
          },
        ],
      });

      const answer =
        ai.output_text?.trim() ||
        'Disculpa, ¿te interesa que te cuente una promoción breve?';

      console.log('AI answer:', answer);

      if (answer === 'TRANSFER_HUMAN') {
        endCall('Perfecto, te comunico con un asesor ahora mismo.');
        return;
      }

      if (answer === 'SEND_WHATSAPP') {
        endCall('Perfecto, te enviaremos la información por WhatsApp en breve.');
        return;
      }

      if (
        answer.toLowerCase().includes('promoción') ||
        answer.toLowerCase().includes('beneficio') ||
        answer.toLowerCase().includes('free spins') ||
        answer.toLowerCase().includes('recarga') ||
        answer.toLowerCase().includes('campaña')
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
        token: 'Disculpa, tuve un problema técnico. ¿Te interesa que te lo explique muy breve?',
        last: true,
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});