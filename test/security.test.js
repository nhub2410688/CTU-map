const test = require('node:test');
const assert = require('node:assert/strict');
const {
    hashPassword,
    legacyHashPassword,
    verifyPassword,
    createToken,
    hashToken
} = require('../security');

test('Argon2id hashes and verifies a password', async () => {
    const hash = await hashPassword('StrongPass123');

    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(hash, 'StrongPass123'), true);
    assert.equal(await verifyPassword(hash, 'wrong-password'), false);
    assert.equal(await verifyPassword(null, 'StrongPass123'), false);
    assert.equal(await verifyPassword('not-a-hash', 'StrongPass123'), false);
});

test('legacy SHA-256 helper remains compatible for one-time upgrades', () => {
    const hash = legacyHashPassword('123456', 'legacy-salt');

    assert.equal(hash, legacyHashPassword('123456', 'legacy-salt'));
    assert.notEqual(hash, legacyHashPassword('654321', 'legacy-salt'));
    assert.notEqual(hash, legacyHashPassword('123456', 'other-salt'));
    assert.match(hash, /^[a-f0-9]{64}$/);
});

test('createToken and hashToken work consistently', () => {
    const token = createToken();
    assert.equal(token.length, 64);
    assert.match(token, /^[a-f0-9]+$/);

    const hashed = hashToken(token);
    assert.equal(hashed, hashToken(token));
    assert.notEqual(hashed, token);
    assert.match(hashed, /^[a-f0-9]{64}$/);
});