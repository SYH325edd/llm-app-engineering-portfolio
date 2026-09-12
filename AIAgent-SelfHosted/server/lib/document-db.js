'use strict';

const { randomUUID } = require('node:crypto');

let clientPromise;
let databasePromise;

const COMMAND = Symbol('aiagent-db-command');

function marker(type, value) {
  return Object.freeze({ [COMMAND]: true, type, value });
}

const command = Object.freeze({
  in: (value) => marker('in', Array.isArray(value) ? value : []),
  gt: (value) => marker('gt', value),
  gte: (value) => marker('gte', value),
  lt: (value) => marker('lt', value),
  lte: (value) => marker('lte', value),
  inc: (value) => marker('inc', Number(value || 0)),
  set: (value) => marker('set', value),
});

function isMarker(value) {
  return Boolean(value && typeof value === 'object' && value[COMMAND] === true);
}

function databaseName() {
  return String(process.env.DATABASE_NAME || 'aiagent').trim() || 'aiagent';
}

async function getClient() {
  if (!clientPromise) {
    const uri = String(process.env.DATABASE_URL || '').trim();
    if (!uri) throw Object.assign(new Error('DATABASE_URL is required'), { code: 'DATABASE_URL_MISSING' });
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { maxPoolSize: 20, minPoolSize: 1, retryWrites: true });
    clientPromise = client.connect().then(() => client).catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

async function nativeDatabase() {
  if (!databasePromise) databasePromise = getClient().then((client) => client.db(databaseName()));
  return databasePromise;
}

function translateValue(value) {
  if (!isMarker(value)) return value;
  const operators = { in: '$in', gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte' };
  const operator = operators[value.type];
  return operator ? { [operator]: value.value } : value.value;
}

function translateFilter(filter = {}) {
  const result = {};
  for (const [key, value] of Object.entries(filter || {})) result[key] = translateValue(value);
  return result;
}

function unwrapData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value || {};
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === 'data' && value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    ? value.data
    : value;
}

function buildUpdate(value) {
  const data = unwrapData(value);
  const $set = {};
  const $inc = {};
  for (const [key, item] of Object.entries(data || {})) {
    if (key === '_id') continue;
    if (isMarker(item) && item.type === 'inc') $inc[key] = Number(item.value || 0);
    else if (isMarker(item) && item.type === 'set') $set[key] = item.value;
    else $set[key] = item;
  }
  const update = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($inc).length) update.$inc = $inc;
  return update;
}

function writeResult(result) {
  const updated = Number(result?.modifiedCount ?? result?.matchedCount ?? result?.upsertedCount ?? 0);
  return { updated, matched: Number(result?.matchedCount ?? updated), stats: { updated }, data: { updated } };
}

class DocumentReference {
  constructor(database, collectionName, id, session) {
    this.database = database;
    this.collectionName = collectionName;
    this.id = String(id || '');
    this.session = session;
  }

  async native() { return (await this.database.native()).collection(this.collectionName); }

  async get() {
    const value = await (await this.native()).findOne({ _id: this.id }, { session: this.session });
    if (!value) throw Object.assign(new Error('document not found'), { code: 'DOCUMENT_NOT_FOUND' });
    return { data: value };
  }

  async set(value) {
    const data = { ...unwrapData(value), _id: this.id };
    const result = await (await this.native()).replaceOne({ _id: this.id }, data, { upsert: true, session: this.session });
    return writeResult(result);
  }

  async update(value) {
    const update = buildUpdate(value);
    if (!Object.keys(update).length) return { updated: 0, matched: 0, stats: { updated: 0 }, data: { updated: 0 } };
    const result = await (await this.native()).updateOne({ _id: this.id }, update, { session: this.session });
    return writeResult(result);
  }

  async remove() {
    const result = await (await this.native()).deleteOne({ _id: this.id }, { session: this.session });
    return { deleted: Number(result.deletedCount || 0), removed: Number(result.deletedCount || 0) };
  }
}

class Query {
  constructor(database, collectionName, session, state = {}) {
    this.database = database;
    this.collectionName = collectionName;
    this.session = session;
    this.state = { filter: {}, sort: undefined, skip: 0, limit: undefined, projection: undefined, ...state };
  }

  clone(patch) { return new Query(this.database, this.collectionName, this.session, { ...this.state, ...patch }); }
  where(filter) { return this.clone({ filter: translateFilter(filter) }); }
  orderBy(field, direction) { return this.clone({ sort: { [field]: String(direction).toLowerCase() === 'desc' ? -1 : 1 } }); }
  skip(value) { return this.clone({ skip: Math.max(0, Number(value || 0)) }); }
  limit(value) { return this.clone({ limit: Math.max(0, Number(value || 0)) }); }
  field(value) {
    const projection = Object.fromEntries(Object.entries(value || {}).map(([key, enabled]) => [key, enabled ? 1 : 0]));
    return this.clone({ projection });
  }

  async native() { return (await this.database.native()).collection(this.collectionName); }

  async get() {
    let cursor = (await this.native()).find(this.state.filter, { session: this.session, projection: this.state.projection });
    if (this.state.sort) cursor = cursor.sort(this.state.sort);
    if (this.state.skip) cursor = cursor.skip(this.state.skip);
    if (Number.isFinite(this.state.limit)) cursor = cursor.limit(this.state.limit);
    return { data: await cursor.toArray() };
  }

  async count() {
    return { total: await (await this.native()).countDocuments(this.state.filter, { session: this.session }) };
  }

  async update(value) {
    const update = buildUpdate(value);
    if (!Object.keys(update).length) return { updated: 0, matched: 0, stats: { updated: 0 }, data: { updated: 0 } };
    return writeResult(await (await this.native()).updateMany(this.state.filter, update, { session: this.session }));
  }

  async remove() {
    const result = await (await this.native()).deleteMany(this.state.filter, { session: this.session });
    return { deleted: Number(result.deletedCount || 0), removed: Number(result.deletedCount || 0) };
  }
}

class Collection extends Query {
  constructor(database, collectionName, session) {
    super(database, collectionName, session);
  }

  doc(id) { return new DocumentReference(this.database, this.collectionName, id, this.session); }

  async add(value) {
    const data = { ...unwrapData(value) };
    if (!data._id) data._id = randomUUID();
    await (await this.native()).insertOne(data, { session: this.session });
    return { _id: data._id, id: data._id };
  }
}

class DocumentDatabase {
  constructor(session = undefined) {
    this.session = session;
    this.command = command;
  }

  async native() { return nativeDatabase(); }
  collection(name) { return new Collection(this, String(name), this.session); }

  async createCollection(name) {
    const db = await this.native();
    const exists = await db.listCollections({ name: String(name) }, { nameOnly: true }).hasNext();
    if (exists) throw Object.assign(new Error('collection already exists'), { code: 'COLLECTION_ALREADY_EXISTS' });
    await db.createCollection(String(name), { session: this.session });
    return { created: true };
  }

  async runTransaction(callback) {
    const client = await getClient();
    const session = client.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        result = await callback(new DocumentDatabase(session));
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}

const database = new DocumentDatabase();

async function closeDatabase() {
  if (clientPromise) {
    const client = await clientPromise.catch(() => null);
    if (client) await client.close();
  }
  clientPromise = undefined;
  databasePromise = undefined;
}

module.exports = {
  command,
  getDatabase: () => database,
  closeDatabase,
  __test: { translateFilter, buildUpdate, unwrapData, isMarker },
};
