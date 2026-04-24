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
const HUMAN_AGENT_NUMBER = '+56923742126';

if (!PUBLIC_HOST) console.error('Missing PUBLIC_HOST');
if (!OPENAI_API_KEY) console.error('Missing OPENAI_API_KEY');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
  <Connect action="https://${PUBLIC_HOST}/relay-complete" method="POST">
    <ConversationRelay
      url="wss://${PUBLIC_HOST}/ws"
      welcomeGreeting="Hola, te habla Valentina de JuegaPlus. Estamos contactando a algunas personas en Chile para contarles sobre beneficios y promociones disponibles en nuestra plataforma. Es algo súper breve, ¿te puedo explicar en unos segundos?"
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

app.post('/relay-complete', (req, res) => {
  console.log('RELAY COMPLETE CALLBACK:', JSON.stringify(req.body));

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="es-CL">
    Perfecto, te comunico con un asesor de JuegaPlus ahora mismo.
  </Say>
  <Dial 
    callerId="+56227300531"
    timeout="25"
    action="https://${PUBLIC_HOST}/dial-complete"
    method="POST">
    <Number>+50589338699</Number>
  </Dial>
</Response>`;

  console.log('TRANSFER TWIML OUT:', twiml);

  res.type('text/xml');
  res.send(twiml);
});

app.post('/relay-complete', (req, res) => {
  console.log('RELAY COMPLETE CALLBACK:', JSON.stringify(req.body));

  let handoff = null;

  try {
    handoff = req.body.HandoffData ? JSON.parse(req.body.HandoffData) : null;
  } catch (err) {
    console.error('Invalid HandoffData:', req.body.HandoffData);
  }

  const shouldTransfer =
    handoff &&
    handoff.reasonCode === 'live-agent-handoff';

  if (!shouldTransfer) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;

    console.log('NO HANDOFF DATA - NOT TRANSFERRING');
    res.type('text/xml');
    res.send(twiml);
    return;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="es-CL">
    Perfecto, te comunico con un asesor de JuegaPlus ahora mismo.
  </Say>
  <Dial
    callerId="+56227300531"
    timeout="25"
    action="https://${PUBLIC_HOST}/dial-complete"
    method="POST">
    <Number>+56923742126</Number>
  </Dial>
</Response>`;

  console.log('TRANSFER TWIML OUT:', twiml);

  res.type('text/xml');
  res.send(twiml);
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

function transferToHuman(ws, reason = 'The caller is interested and wants to speak with a human advisor') {
  console.log('TRANSFERRING TO HUMAN:', reason);

  safeSend(ws, {
    type: 'end',
    handoffData: JSON.stringify({
      reasonCode: 'live-agent-handoff',
      reason,
      targetNumber: HUMAN_AGENT_NUMBER,
    }),
  });
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

function isPositiveReply(text) {
  const normalized = normalizeText(text);
  return (
    normalized === 'si' ||
    normalized.includes('claro') ||
    normalized.includes('dale') ||
    normalized.includes('bueno') ||
    normalized.includes('ok') ||
    normalized.includes('vale') ||
    normalized.includes('dime') ||
    normalized.includes('cuentame') ||
    normalized.includes('interesa') ||
    normalized.includes('explica')
  );
}

function isNegativeReply(text) {
  const normalized = normalizeText(text);
  return (
    normalized === 'no' ||
    normalized.includes('no gracias') ||
    normalized.includes('no me interesa') ||
    normalized.includes('ahora no') ||
    normalized.includes('despues') ||
    normalized.includes('ocupado') ||
    normalized.includes('ocupada') ||
    normalized.includes('no quiero')
  );
}

function soundsUnclear(text) {
  const normalized = normalizeText(text);
  return (
    normalized.length <= 1 ||
    normalized === 'ah' ||
    normalized === 'eh' ||
    normalized === 'mm' ||
    normalized === 'mmm' ||
    normalized === 'hola' ||
    normalized === 'que' ||
    normalized === 'que cosa'
  );
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
    normalized.includes('si por favor') ||
    normalized.includes('yo quiero') ||
    normalized.includes('quiero') ||
    normalized.includes('ok esta bien') ||
    normalized.includes('esta bien') ||
    normalized.includes('dale') ||
    normalized.includes('asesor') ||
    normalized.includes('comunicarme') ||
    normalized.includes('registrar') ||
    normalized.includes('registro') ||
    normalized.includes('como me registro') ||
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

    if (farewellText) {
      safeSend(ws, {
        type: 'text',
        token: farewellText,
        last: true,
      });
    }

    setTimeout(() => {
      safeSend(ws, { type: 'end' });
    }, 800);
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

      if (isEndCallReply(userText) || isNegativeReply(userText)) {
        endCall('Entiendo, muchas gracias por tu tiempo. Que tengas un buen día.');
        return;
      }

      if (isConfusedReply(userText)) {
        safeSend(ws, {
          type: 'text',
          token: 'Claro. Te llamo de JuegaPlus para contarte brevemente sobre beneficios como free spins, bonos por recarga y promociones de la plataforma. ¿Te interesa que te explique?',
          last: true,
        });
        return;
      }

       if (promotionExplained && (isInterestedAfterPromotion(userText) ||  isPositiveReply(userText))) {
       transferToHuman(ws, 'Caller showed interest after hearing the promotion');
       return;
       }

      if (!promotionExplained && isPositiveReply(userText)) {
        promotionExplained = true;

        safeSend(ws, {
          type: 'text',
          token: 'Perfecto, te cuento rápido. En JuegaPlus puedes encontrar beneficios como free spins de registro, bonos por recarga con free spins y algunas promociones exclusivas. Si te interesa, un asesor puede explicártelo mejor o ayudarte a registrarte.',
          last: true,
        });

        return;
      }

      if (soundsUnclear(userText) && clarificationCount < 1) {
        clarificationCount += 1;

        safeSend(ws, {
          type: 'text',
          token: 'Claro. Es algo breve: JuegaPlus tiene beneficios como free spins de registro, bonos por recarga y promociones. ¿Te interesa que te cuente?',
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

Hablas con personas que NO necesariamente son usuarios registrados.
Tu objetivo es presentar brevemente JuegaPlus y generar interés sin presionar.

CONTEXTO:
- El usuario puede no conocer JuegaPlus.
- No asumas que tiene cuenta.
- No digas que tiene promociones activas en su cuenta.
- No prometas ganancias.
- No uses lenguaje agresivo de venta.
- No te presentes de nuevo, porque la bienvenida inicial ya fue dicha por el sistema.
- Habla en español chileno, natural, breve y amable.

PROMOCIÓN / BENEFICIOS GENERALES:
"En JuegaPlus puedes encontrar beneficios como free spins de registro, bonos por recarga con free spins y promociones exclusivas."

OBJETIVO DE LA LLAMADA:
1. Confirmar si el usuario quiere escuchar la información.
2. Si acepta, explicar brevemente los beneficios generales.
3. Si muestra interés, responde SOLO: TRANSFER_HUMAN
4. Si pide WhatsApp, responde SOLO: SEND_WHATSAPP
5. Si no quiere, responde SOLO: END_CALL
6. Si no entiende, explica de forma más simple.

RESPUESTAS RECOMENDADAS:
- Si pregunta "¿qué es JuegaPlus?":
"JuegaPlus es una plataforma online de entretenimiento. Tenemos beneficios como free spins de registro, bonos por recarga y promociones."

- Si dice "sí", "ok", "dime", "claro":
"Perfecto. En JuegaPlus puedes encontrar free spins de registro, bonos por recarga con free spins y promociones exclusivas."

- Si pregunta "¿qué promoción?":
"Son beneficios generales de la plataforma, como free spins de registro, bonos por recarga y promociones. Un asesor puede explicártelo mejor."

- Si pide WhatsApp:
SEND_WHATSAPP

- Si pregunta algo complejo:
TRANSFER_HUMAN

- Si dice que no:
END_CALL

FORMATO:
- Máximo 1 o 2 frases.
- No más de 20 palabras por respuesta, salvo aclaración.
- No inventes montos ni bonos garantizados.
- No digas que el usuario ya tiene una cuenta.
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
        'Disculpa, ¿te interesa que te cuente brevemente sobre JuegaPlus?';

      console.log('AI answer:', answer);

      const command = normalizeText(answer);

      if (command.includes('transfer_human') || command.includes('transer_human')) {
        transferToHuman(ws, 'AI classified caller as interested');
        return;
      }

      if (command.includes('send_whatsapp')) {
        endCall('Perfecto, te enviaremos la información por WhatsApp en breve. Gracias por tu tiempo.');
        return;
      }

      if (command.includes('end_call')) {
        endCall('Entiendo, muchas gracias por tu tiempo. Que tengas un buen día.');
        return;
      }

      if (
        normalizeText(answer).includes('free spins') ||
        normalizeText(answer).includes('bonos') ||
        normalizeText(answer).includes('promociones') ||
        normalizeText(answer).includes('beneficios') ||
        normalizeText(answer).includes('recarga')
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
        token: 'Disculpa, tuve un problema técnico. Gracias por tu tiempo.',
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