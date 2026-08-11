const crypto = require('crypto');
const argon2 = require('argon2');

async function hashPassword(password){
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1
    });
}

async function verifyPassword(hash, password){
    if(!hash || !hash.startsWith('$argon2id$')){
        return false;
    }

    try{
        return await argon2.verify(hash, password);
    }
    catch{
        return false;
    }
}

function legacyHashPassword(password, salt){
    return crypto
        .createHash('sha256')
        .update(`${salt}:${password}`)
        .digest('hex');
}

function createToken(){
    return crypto.randomBytes(32).toString('hex');
}

function hashToken(token){
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
}

module.exports = {
    createToken,
    hashPassword,
    hashToken,
    legacyHashPassword,
    verifyPassword
};
