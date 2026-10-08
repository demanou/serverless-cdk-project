// Unit tests for lambda/index.js. The AWS SDK is mocked, so no AWS account
// or network access is needed.

const send = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn() }), { virtual: true });
jest.mock(
  '@aws-sdk/lib-dynamodb',
  () => {
    const command = (type: string) =>
      jest.fn().mockImplementation((input) => ({ type, input }));
    return {
      DynamoDBDocumentClient: { from: () => ({ send }) },
      ScanCommand: command('Scan'),
      PutCommand: command('Put'),
      GetCommand: command('Get'),
      DeleteCommand: command('Delete'),
    };
  },
  { virtual: true },
);

process.env.TABLE_NAME = 'StudentItems';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../lambda/index.js');

const event = (httpMethod: string, resource: string, extra: Record<string, unknown> = {}) => ({
  httpMethod,
  resource,
  ...extra,
});

const call = async (e: unknown) => {
  const res = await handler(e, {});
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

beforeEach(() => send.mockReset());

test('GET /items returns all items', async () => {
  send.mockResolvedValue({ Items: [{ id: '1001' }] });
  const res = await call(event('GET', '/items'));
  expect(res.status).toBe(200);
  expect(res.body).toEqual([{ id: '1001' }]);
});

test('POST /items creates an item (201)', async () => {
  send.mockResolvedValue({});
  const res = await call(event('POST', '/items', { body: JSON.stringify({ id: '1003', name: 'Amazon S3' }) }));
  expect(res.status).toBe(201);
  expect(send.mock.calls[0][0].input.ConditionExpression).toBe('attribute_not_exists(id)');
});

test('POST /items without a name returns 400', async () => {
  const res = await call(event('POST', '/items', { body: JSON.stringify({ id: '1003' }) }));
  expect(res.status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});

test('POST /items with an existing id returns 409', async () => {
  send.mockRejectedValue(Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }));
  const res = await call(event('POST', '/items', { body: JSON.stringify({ id: '1001', name: 'Dup' }) }));
  expect(res.status).toBe(409);
});

test('POST /items with invalid JSON returns 400', async () => {
  const res = await call(event('POST', '/items', { body: '{not json' }));
  expect(res.status).toBe(400);
});

test('GET /items/{id} returns 404 when the item does not exist', async () => {
  send.mockResolvedValue({});
  const res = await call(event('GET', '/items/{id}', { pathParameters: { id: '9999' } }));
  expect(res.status).toBe(404);
});

test('PUT /items/{id} uses the id from the URL, not the body', async () => {
  send.mockResolvedValue({});
  const res = await call(
    event('PUT', '/items/{id}', { pathParameters: { id: '1001' }, body: JSON.stringify({ id: 'other', name: 'CDK v2' }) }),
  );
  expect(res.status).toBe(200);
  expect(send.mock.calls[0][0].input.Item.id).toBe('1001');
});

test('DELETE /items/{id} deletes the item', async () => {
  send.mockResolvedValue({});
  const res = await call(event('DELETE', '/items/{id}', { pathParameters: { id: '1002' } }));
  expect(res.status).toBe(200);
  expect(send.mock.calls[0][0].input.Key).toEqual({ id: '1002' });
});

test('unknown routes return 405', async () => {
  const res = await call(event('PATCH', '/items'));
  expect(res.status).toBe(405);
});
