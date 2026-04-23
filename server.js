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

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (_req, res) => {
  res.send('AI Phone Server Running 🚀');
});

app.post('/voice', (_req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://${PUBLIC_HOST}/ws"
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
</Response>`;

  res.type('text/xml').send(twiml);
});

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  console.log('Twilio WebSocket connected');

  let introDone = true; // welcomeGreeting 已经说过了
  let promotionExplained = false;
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

  const timer = setTimeout(() => {
    endCall();
  }, 120000);

  ws.on('close', () => {
    clearTimeout(timer);
    console.log('Twilio WebSocket disconnected');
  });

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log('WS IN:', JSON.stringify(data));

      if (callEnded) return;

      if (data.type === 'setup') return;
      if (data.type === 'interrupt') return;

      const userText = data.voicePrompt || data.prompt || data.text || '';
      if (!userText) return;

      const normalized = userText.toLowerCase().trim();

      // 明确拒绝
      if (
        normalized.includes('no gracias') ||
        normalized.includes('no me interesa') ||
        normalized === 'no' ||
        normalized.includes('ahora no') ||
        normalized.includes('después')
      ) {
        endCall('Entiendo, muchas gracias por tu tiempo. Que estés muy bien.');
        return;
      }

      // 明确同意，且尚未讲过 promotion
      if (
        !promotionExplained &&
        (
          normalized.includes('sí') ||
          normalized.includes('si') ||
          normalized.includes('claro') ||
          normalized.includes('dime') ||
          normalized.includes('ok') ||
          normalized.includes('vale') ||
          normalized.includes('interesa')
        )
      ) {
        promotionExplained = true;
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

La bienvenida inicial ya fue dada por el sistema.
NO te presentes de nuevo.
NO repitas la pregunta inicial si el usuario ya respondió.

OBJETIVO:
1. Continuar la conversación de forma breve.
2. Si el usuario quiere detalles, explica brevemente la promoción.
3. Si después sigue interesado, responde SOLO: TRANSFER_HUMAN
4. Si pide WhatsApp, responde SOLO: SEND_WHATSAPP
5. Si no tiene interés, despídete brevemente.

PROMOCIÓN BASE:
"Actualmente podrías tener acceso a promociones activas, beneficios en recarga, free spins o campañas especiales disponibles dentro de tu cuenta de JuegaPlus."

REGLAS:
- Respuestas cortas.
- No prometas ganancias.
- Si pregunta algo complejo, responde SOLO: TRANSFER_HUMAN
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