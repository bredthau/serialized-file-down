# serialized-file-down

An [Abstract-LevelDown](https://github.com/Level/abstract-leveldown) complient store that serializes data to a file on disk. It is inspired by [Jsondown](https://github.com/toolness/jsondown) but with the ability to override the default serialization behaviour. This makes it possible to inspect the persisted database for debug purposes.

By default it uses [memdown](https://github.com/Level/memdown) and [encodingdown](https://github.com/Level/encoding-down) in order to provide a snapshotable memory view, using the provided serializer to persist the data to disk. This is mostly geared towards debugging and for small datasets where the possibility that a more scalable backend is needed later on exists. However this default can be overriden using the `db` option to put it above any `leveldown` store. Note however that all data will be loaded into memory for serialization so this is definately not suited for large databases.

## Installation
This library requires __node v.8.6.0__ or higher. In principle the library should work with node versions since __node v.8.0.0__, however the tests do not, so use at your own risk.

```
$ npm install serialized-file-down
```


## Usage

```js
const levelup  = require('levelup');
const filedown = require('serialized-file-down');
const db       = levelup(filedown('./db.json'));
```

`serialized-file-down` defaults to an object base storage using `encoding-down`.

```js
await db.put('foo', {foo: "bar"});
const obj = await db.get('foo');
//obj.foo === "bar"
```
Resulting `db.json`:
```json
[{"key":"foo","value":{"foo":"bar"}}]
```

`file-down` supports different serializers/deserializers, e.g. using extra parameters for `JSON.stringify` to give readable output:

```js
const levelup  = require('levelup');
const filedown = require('serialized-file-down');
const db       = levelup(filedown('./db.json'), { serialize(x) { return JSON.stringify(x, null, 4); }});
```

or YAML-Output:
```js
const levelup  = require('levelup');
const filedown = require('serialized-file-down');
const yaml     = require('js-yaml');
const db       = levelup(filedown('./db.yaml'), { serialize: yaml.safeDump, deserialize: yaml.safeLoad });
```

It can also do things like compress the database:

```js
const levelup     = require('levelup');
const filedown    = require('serialized-file-down');
const zlib        = require('zlib');
const {promisify} = require('util');
const [gzip, gunzip] = [zlib.gzip, zlib.gunzip].map(promisify);
const serializer = {
    useBuffers: true,
    async serialize(x)   { return gzip(JSON.stringify(x)); },
    async deserialize(x) { return JSON.parse((await gunzip(x)).toString("utf8")); }
};
const db       = levelup(filedown('./db.json.gz'), { serializer });
```
## Note
In order to get full use out of this library, any higher level `encoding-down` instances (e.g. provided by [subleveldown](https://github.com/Level/subleveldown) should be set to bypass encoding for values using `valueEncoding = 'id'`

```js
const levelup  = require('levelup');
const sub      = require('subleveldown');
const filedown = require('serialized-file-down');
const db       = levelup(filedown('./db.json'));
const data	   = sub(db, 'data', { valueEncoding: 'id' });
```

## API
`db = require('filedown')(path[, options])`

* `path` identifies the file in which the database should be persisted.
* `options` is an object which can have the following keys:
  * `delay`: delay in ms to apply before persisting changes to file. This is used to ensure that the file isn't constantly rewritten. Defaults to `1000` (`1` second). If `delay` is `0` operations changing the database will return only after the change has been written to file, otherwise it happens asynchronously.
  * `db`: Internal `levelDown` store to use for data management. Defaults to `encodingdown(memdown(), { valueEncoding: 'json', keyEncoding: 'json' })`. 
  * `serializer`: An object containing:
    * `serialize`: Function used for serializing data to disk, defaults to `JSON.stringify`
    * `deserialize`: Function for deserializing data on `db.open()`. Defaults to `JSON.parse`
    * `useBuffers`: Indicates whether `serialize` and `deserialize` work on `Buffers` or `strings`. Defaults to `false`.
  * `backup`: Indicates how to backup the existing version of the database file. Defaults to `true`.
  * `next`:   Indicates if new versions of the database file should be temporarily stored under a different name and renamed only after writing has finished successfully. Defaults to `true`.

The `serialize` function must take an array of objects with fields `key` and `value`, e.g. `{ key: "foo", value: {foo: "bar"}}` and must return a `string` if `useBuffers` is `false` or a`Buffer` if `useBuffers` is `true` representing that array. The `deserialize` function must take the output of `serialize` and convert it back into an array of objects with fields `key` and `value`. `serialize` and `deserialize` can be asynchronous functions returning a `Promise`.

`backup` can be either `boolean`, `string` or `function`. For a value of `true` the backup will be stored as `path.back` respectively. A value of `false` disables the functionality. A `string` gives a path for the backup, with an empty string disabling the functionality. A `function` is interpreted as if `backup` was the result of calling that function each time the file is written. The function can also be asynchronous returning a `Promise`.

`next` works the same way as `backup` with the default path being `path.next`.
