const test     = require('tape-async');
const tempy    = require('tempy');
const suite    = require('abstract-leveldown/test');
const path     = require('path');
const memdown  = require('memdown');
const fileDown = require('..');
const zlib                 = require('zlib');
const {promisify}         = require('util');
const [gzip, gunzip] = [zlib.gzip, zlib.gunzip].map(x => promisify(x));


const testCommon = suite.common({
    test,
    clear: true,
    factory() {
        return fileDown(path.join(tempy.directory(), "db.json"), {delay: 0, db: memdown()});
    }
});
const testBufferSerializerNoNext = suite.common({
    test,
    clear: true,
    factory() {
        return fileDown(path.join(tempy.directory(), "db.json"), {
            delay:      0,
            db:         memdown(),
            serializer: {
                useBuffers: true,
                async serialize(x)   { return gzip(JSON.stringify(x)); },
                async deserialize(x) { return JSON.parse((await gunzip(x)).toString("utf8")); }
            },
            backup: true,
            next:   false
        });
    }
});
const testBufferSerializerRandomNextBackup = suite.common({
    test,
    clear: true,
    factory() {
        return fileDown(path.join(tempy.directory(), "db.json"), {
            delay:      0,
            db:         memdown(),
            backup() { return Math.random() > 0.5 ? path.join(tempy.directory(), ((Math.random() * 5)|0)+".json.back") : ""; },
            next()   { return Math.random() > 0.5 ? path.join(tempy.directory(), ((Math.random() * 5)|0)+".json.next") : ""; },
        });
    }
});

suite(testCommon);
suite(testBufferSerializerNoNext);
suite(testBufferSerializerRandomNextBackup);


