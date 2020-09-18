import * as R from 'ramda';
import * as bodyParser from 'body-parser';
import { logger, OPENCTI_TOKEN } from '../config/conf';
import { authentication, BYPASS } from '../domain/user';
import { extractTokenFromBearer } from './graphql';
import { getStreamRange, createStreamProcessor } from '../database/redis';
import { ENTITY_TYPE_MARKING_DEFINITION } from '../schema/stixMetaObject';

let heartbeat;
const KEEP_ALIVE_INTERVAL_MS = 20000;
const broadcastClients = {};

const createBroadcastClient = (client) => {
  const broadcastClient = {
    client,
    sendEvent: (eventId, topic, event) => {
      const { data } = event;
      const clientMarkings = R.map((m) => m.standard_id, client.allowed_marking);
      const isMarking = data.type === ENTITY_TYPE_MARKING_DEFINITION.toLowerCase();
      const isUserHaveAccess = event.markings.length > 0 && event.markings.every((m) => clientMarkings.includes(m));
      const granted = isMarking || isUserHaveAccess;
      const accessData = Object.assign(event, { granted });
      if (granted || client.bypass_role) {
        client.sendEvent(eventId, topic, accessData);
      } else {
        const filteredData = R.pick(['markings', 'timestamp', 'granted'], accessData);
        client.sendEvent(eventId, topic, filteredData);
      }
      return true;
    },
    sendHeartbeat: () => {
      client.sendEvent(undefined, 'heartbeat', new Date());
    },
    sendConnected: (streamInfo) => {
      client.sendEvent(undefined, 'connected', streamInfo);
      broadcastClient.sendHeartbeat();
    },
  };
  return broadcastClient;
};

const createHeartbeatProcessor = () => {
  // Setup the heart beat
  heartbeat = setInterval(() => {
    const now = Date.now() / 1000;
    // Close expired sessions
    Object.values(broadcastClients)
      .filter((c) => now >= c.client.expirationTime)
      .forEach((c) => c.client.close());
    // Send heartbeat to alive sessions
    Object.values(broadcastClients)
      // Filter is required as the close is asynchronous
      .filter((c) => now < c.client.expirationTime)
      .forEach((c) => c.sendHeartbeat());
  }, KEEP_ALIVE_INTERVAL_MS);
};

export const initBroadcaster = () => {
  return createStreamProcessor(async (eventId, topic, data) => {
    const now = Date.now() / 1000;
    Object.values(broadcastClients)
      // Filter is required as the close is asynchronous
      .filter((c) => now < c.client.expirationTime)
      .forEach((c) => c.sendEvent(eventId, topic, data));
  });
};

export const broadcast = (event, data) => {
  Object.values(broadcastClients).forEach((broadcastClient) => {
    broadcastClient.sendEvent(event, data);
  });
};

const authenticate = async (req, res, next) => {
  let token = req.cookies ? req.cookies[OPENCTI_TOKEN] : null;
  token = token || extractTokenFromBearer(req.headers.authorization);
  const auth = await authentication(token);
  if (auth) {
    req.userId = auth.id;
    req.bypass_role = R.find((s) => s.name === BYPASS, auth.capabilities) !== undefined;
    req.allowed_marking = auth.allowed_marking;
    req.expirationTime = new Date(2100, 10, 10); // auth.token.expirationTime;
    next();
  } else {
    res.status(401).json({ status: 'unauthorized' });
  }
};

const streamHistoryHandler = async (req, res) => {
  const { userId, body } = req;
  const clients = Object.entries(broadcastClients);
  const connectedClient = R.find(([, data]) => {
    return data.client.userId === userId;
  }, clients);
  if (!connectedClient) {
    res.status(401).json({ status: 'Users stream not connected' });
  } else {
    const { from = '-', size = 200 } = body;
    const broadcastClient = R.last(connectedClient);
    try {
      const rangeProcessor = (eventId, topic, data) => broadcastClient.sendEvent(eventId, topic, data);
      await getStreamRange(from, size, rangeProcessor);
      res.json({ success: true });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  }
};

const createSeeMiddleware = (broadcaster) => {
  createHeartbeatProcessor();
  const eventsHandler = (req, res) => {
    const client = {
      userId: req.userId,
      expirationTime: req.expirationTime,
      allowed_marking: req.allowed_marking,
      bypass_role: req.bypass_role,
      sendEvent: (id, topic, data) => {
        if (req.finished) {
          logger.info('[STREAM] Write on an already terminated response', { id: client.userId });
          return;
        }
        let message = '';
        if (id) {
          message += `id: ${id}\n`;
        }
        if (topic) {
          message += `event: ${topic}\n`;
        }
        message += 'data: ';
        message += JSON.stringify(data);
        message += '\n\n';
        res.write(message);
        res.flush();
      },
      close: () => {
        client.expirationTime = 0;
        try {
          res.end();
        } catch (e) {
          logger.error('[STREAM] Failing to close client', { clientId: client.userId, error: e });
        }
      },
    };
    req.on('close', () => {
      if (client === broadcastClients[client.userId]?.client) {
        delete broadcastClients[client.userId];
      }
    });
    res.writeHead(200, {
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform', // no-transform is required for dev proxy
    });
    // Only one connection per client
    const previousClient = broadcastClients[req.userId];
    if (previousClient) {
      previousClient.client.close();
      delete broadcastClients[req.userId];
    }
    // Create the new connection
    const broadcastClient = createBroadcastClient(client);
    broadcastClients[client.userId] = broadcastClient;
    const clients = Object.entries(broadcastClients).length;
    broadcastClient.sendConnected(Object.assign(broadcaster.info(), { clients }));
    logger.debug(`[STREAM] Clients connection ${req.userId} (${clients})`);
  };
  return {
    shutdown: () => {
      clearInterval(heartbeat);
      Object.values(broadcastClients).forEach((c) => c.client.close());
      broadcaster.shutdown();
    },
    applyMiddleware: ({ app }) => {
      app.use('/stream', authenticate);
      app.get('/stream', eventsHandler);
      app.use('/stream/history', bodyParser.json());
      app.post('/stream/history', streamHistoryHandler);
    },
  };
};

export default createSeeMiddleware;
