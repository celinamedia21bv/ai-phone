import 'dotenv/config';
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

app.post('/call-status', (req, res) => {
  console.log('CALL STATUS CALLBACK:', JSON.stringify(req.body));
  res.sendStatus(200);
});

app.post('/voice', (_req, res) => {
  try {
    console.log('POST /voice hit');
    console.log('PUBLIC_HOST =', PUBLIC_HOST);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://${PUBLIC_HOST}/ws"
      welcomeGreeting="Hola, te habla Valentina de JuegaPlus. Te llamo porque podrías tener promociones o beneficios disponibles en tu cuenta. ¿Te interesa que te lo explique en unos segundos?"
      language="es-CL"
      transcriptionProvider="Deepgram"
      speechModel="nova-3-general"
      ttsProvider="ElevenLabs"
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

function isVoicemailReply(text) {
  const normalized = normalizeText(text);
  return (
    normalized.includes('servicio de') ||
    normalized.includes('buzon') ||
    normalized.includes('buzon de voz') ||
    normalized.includes('deje su mensaje') ||
    normalized.includes('mensaje de voz') ||
    normalized.includes('no se encuentra disponible') ||
    normalized.includes('despues del tono') ||
    normalized.includes('casilla de voz')
  );
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
  const normalized = normalizeText(text);
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
  const normalized = normalizeText(text);
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
  const normalized = normalizeText(text).trim();
  return (
    normalized.length <= 1 ||
    normalized === 'ah' ||
    normalized === 'eh' ||
    normalized === 'mm' ||
    normalized === 'mmm' ||
    normalized === 'hola'
  );
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!?;:¡¿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEndCallReply(text) {
  const normalized = normalizeText(text);
  return (
    normalized.includes('termina') ||
    normalized.includes('corta') ||
    normalized.includes('adios') ||
    normalized.includes('chao') ||
    normalized.includes('chau') ||
    normalized.includes('bye') ||
    normalized.includes('no quiero') ||
    normalized.includes('no me interesa') ||
    normalized.includes('no gracias')
  );
}

function isConfusedReply(text) {
  const normalized = normalizeText(text);
  return (
    normalized.includes('no entendi') ||
    normalized.includes('no te entendi') ||
    normalized.includes('que cosa') ||
    normalized.includes('como') ||
    normalized.includes('que dijiste') ||
    normalized.includes('repite') ||
    normalized.includes('no escuche')
  );
}

function isInterestedAfterPromotion(text) {
  const normalized = normalizeText(text);
  return (
    normalized.includes('me interesa') ||
    normalized.includes('si quiero') ||
    normalized.includes('quiero') ||
    normalized.includes('dale') ||
    normalized.includes('asesor') ||
    normalized.includes('whatsapp')
  );
}

wss.on('connection', (ws, request) => {
  console.log('Twilio WebSocket connected:', request?.url);

  let promotionExplained = false;
  let clarificationCount = 0;
  let callEnded = false;
  let isProcessingTurn = false;

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

      if (isVoicemailReply(userText)) {
       console.log('Voicemail detected, ending call');
       endCall('');
       return;
      }

      if (isProcessingTurn) {
      console.log('Skipping prompt because already processing');
      return;
     }

       isProcessingTurn = true;

     if (isEndCallReply(userText)) {
     endCall('Perfecto, gracias por tu tiempo. Que tengas un buen día.');
     return;
      }

      if (isConfusedReply(userText)) {
      safeSend(ws, {
       type: 'text',
      token: 'Claro. Te llamo de JuegaPlus porque podrías tener promociones o beneficios d         isponibles en tu cuenta. ¿Te interesa que te cuente?',
    last: true,
       });
      return;
       }

       if (promotionExplained && isInterestedAfterPromotion(userText)) {
       endCall('Perfecto, te comunico con un asesor ahora mismo.');
       return;
        }

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
Eres Valentina, una agente telefónica de JuegaPlus.

Hablas en español chileno, de forma natural, breve, amable y humana.
Tu objetivo es explicar en pocos segundos que el usuario podría tener promociones o beneficios disponibles en su cuenta JuegaPlus.

CONTEXTO:
- La bienvenida inicial ya fue dicha por el sistema.
- No te presentes de nuevo.
- No repitas frases largas.
- No prometas ganancias.
- No presiones al usuario.
- No hables como robot.

OBJETIVO DE LA LLAMADA:
1. Confirmar si el usuario quiere escuchar la información.
2. Si acepta, explicar brevemente que podría tener promociones, beneficios de recarga, free spins o campañas disponibles.
3. Si el usuario muestra interés después de escuchar la explicación, responde SOLO: TRANSFER_HUMAN
4. Si el usuario pide WhatsApp, responde SOLO: SEND_WHATSAPP
5. Si el usuario no entiende, repite de forma más simple.
6. Si el usuario no quiere, responde SOLO: END_CALL

PROMOCIÓN BASE:
"Podrías tener promociones activas, beneficios por recarga, free spins o campañas especiales disponibles dentro de tu cuenta JuegaPlus."

RESPUESTAS RECOMENDADAS:
- Si dice "¿qué cosa?" o "no entendí":
"Claro, te explico breve. Te llamo de JuegaPlus porque podrías tener beneficios o promociones disponibles en tu cuenta. ¿Te interesa que te cuente?"

- Si dice "sí", "ok", "dime", "claro":
"Perfecto. Podrías tener promociones activas, beneficios por recarga, free spins o campañas especiales en tu cuenta JuegaPlus."

- Si pregunta "¿qué promoción?":
"Depende de tu cuenta, pero puede incluir beneficios por recarga, free spins o campañas activas. Un asesor puede confirmártelo ahora."

- Si pregunta algo complejo:
TRANSFER_HUMAN

- Si pide WhatsApp:
SEND_WHATSAPP

- Si dice "no", "no gracias", "no me interesa":
END_CALL

FORMATO:
- Máximo 1 o 2 frases.
- Nunca más de 20 palabras salvo que estés aclarando.
- No uses emojis.
- No inventes beneficios exactos.
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

      const command = normalizeText(answer);

if (command.includes('transfer_human') || command.includes('transer_human')) {
  endCall('Perfecto, un asesor de JuegaPlus te contactará en breve. Gracias por tu tiempo.');
  return;
}

if (command.includes('send_whatsapp')) {
  endCall('Perfecto, te enviaremos la información por WhatsApp en breve.');
  return;
}

if (command.includes('end_call')) {
  endCall('Entiendo, muchas gracias por tu tiempo. Que tengas un buen día.');
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
    } finally {
      isProcessingTurn = false;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});