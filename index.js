const {AbstractLevelDOWN, AbstractIterator } = require('abstract-leveldown');
const memdown                = require('memdown');
const encodingDown           = require("encoding-down");
const fs                     = require("fs");
const {promisify}            = require("util");
const [ readFile, writeFile, mkdir, rename] = [fs.readFile, fs.writeFile, fs.mkdir, fs.rename].map(promisify);
const Storing    = Symbol("Storing");
const Store      = Symbol("Store");
const Underlying = Symbol("Underlying");
const StoreQueued= Symbol("StoreQueued");
const QueueHandle= Symbol("QueueHandle");
const Options    = Symbol("Options");
function dataToBatch(arr) {
    return arr.map(({key, value}) => ({type: 'put', key, value}));
}

async function serialize(store) {
    const iter = store.iterator();
    const data = [];
    while(true) {
        const [err, key, value] = await new Promise(res => iter.next((err, key, val) => res([err, key, val])));
        if(err) {
            await new Promise(res => iter.end(res));
            return [err, null];
        }
        else if(key === undefined && value === undefined) {
            await new Promise(res => iter.end(res));
            return [null, data];
        }
        data.push({key, value});
    }
}

function delayed(ms) {
	let handle    = null;
    const result  = new Promise(res => handle = setTimeout(res, ms));
	result.handle = handle;
	return result;
}


class Iterator extends AbstractIterator {
    constructor(db, options) {
        super(db);
        this[Underlying] = db[Underlying].iterator(options);
    }
    _next(cb) {
        this[Underlying].next(cb);
    }
    _seek(cb) {
        this[Underlying].seek(cb);
    }
    _end(cb) {
        this[Underlying].end(cb);
    }
};

function makeFileNameFunc(entry, location, extension) {
    if(typeof entry === "function") return entry;
    if(typeof entry === "string")   return () => entry;
    if(typeof entry === "boolean") {
        if(entry) return () => location + extension;
        else      return () => "";
    }
    throw new Error(`Unsupported argument for entry: ${entry}. Should be a string, bool or function`);
}


class FileLevelDown extends AbstractLevelDOWN {
    constructor(location, {delay = 1000, db = null, serializer= {}, backup = true, next = true} = {}) {
        const underlyingDb = db ? db : encodingDown(memdown(), { valueEncoding: 'json', keyEncoding: 'json' });
        if(!("serialize"   in serializer)) serializer.serialize   = JSON.stringify;
        if(!("deserialize" in serializer)) serializer.deserialize = JSON.parse;
        if(!("useBuffers"  in serializer)) serializer.useBuffers = false;
        super(Object.assign({}, underlyingDb.supports));

        this[Underlying] = underlyingDb;
        this[Storing]    = Promise.resolve();
        this[StoreQueued]= false;
		this[QueueHandle]= null;
        this[Options]    = { location, delay, serializer, db: underlyingDb, backup: makeFileNameFunc(backup, location, ".back"), next: makeFileNameFunc(next, location, ".next") };
    }


    async _open({createIfMissing, errorIfExists}, cb) {
        const underlyingError = await new Promise(res => this[Underlying].open({createIfMissing, errorIfExists}, res));
        if(underlyingError) {
            cb(underlyingError);
            return;
        }
        await new Promise(async (res) => {
            let fData;
            try {
                fData = await readFile(this[Options].location, { encoding: this[Options].serializer.useBuffers ? null : "utf8" });
                if(errorIfExists)
                    return res(new Error(`Can not create db at ${this[Options].location}. File already exists.`));
            }
            catch(e) {
                if(!createIfMissing)
                    return res(new Error(`Can not create db at ${this[Options].location}. File does not exist.`));
                try {
                    await mkdir(path.dirname(this[Options].location, { recursive: true}));
                } catch(e) {}
                fData = await this[Options].serializer.serialize([]);
                await writeFile(this[Options].location, fData, "utf8");
            }

            try {
                const data = await this[Options].serializer.deserialize(fData);
                this[Underlying].batch(dataToBatch(data), {}, res);
            }
            catch(e) {
                res(e);
            }
        }).then((e) => { cb(e); });
    }

	async writeBack(cb) {
		let   resolve;
		const promise = new Promise(res => resolve = res);		
		
		await this[Store](resolve, Promise.resolve(), false);
		const err = await promise;
		if(cb)
			cb(err);
		else if(err)
			throw(new Error(err));
	}

    async [Store](cb, promise, callDelayed = true) {
        let err = await promise;
        if(err || (callDelayed ? this[StoreQueued] : !this[StoreQueued]))
            return cb(err);
        this[StoreQueued] = true;
        const storing 	  = this[Storing];
        this[Storing] 	  = new Promise(async (res, rej) => {
            const options = this[Options];
            try {
				if(callDelayed) {
					await storing;
					const del = delayed(options.delay);
					this[QueueHandle] = del.handle;
					await del;
				} else if(this[QueueHandle])
					clearTimeout(this[QueueHandle]);
				this[QueueHandle] = null;
				
				if(!this[StoreQueued])
					res();
                this[StoreQueued] = false;
                const [err, data] = await serialize(this[Underlying]);
                if(err)
                    throw new Error(`Serialization Failure: `+err);
                const next   = await options.next();
                const backup = await options.backup();
                if(!next && backup)
                    await rename(options.location, backup);
                await writeFile(next ? next : options.location, await options.serializer.serialize(data));
                if(next && backup)
                    await rename(options.location, backup);
                if(next)
                    await rename(next, options.location);
            } catch(e) {
                if(this[Options].delay === 0)
                    return res(e);
                console.log("Storage failure. This can only be handled for delay=0, sorry!\n   "+e.message);
            }
            res();
        });
        if(this[Options].delay === 0)
            err = await this[Storing];
        cb(err);
    }

    async _close(cb) {
        await this.writeBack()
        this[Underlying].close(cb);
    }
    async _clear(opts, cb) {
        await this[Store](cb, new Promise(res => this[Underlying].clear(opts, res)));
    }
    async _put(key, value, opts, cb) {
        await this[Store](cb, new Promise(res => this[Underlying].put(key, value, opts, res)));
    }
    async _del(key, opts, cb) {
        await this[Store](cb, new Promise(res => this[Underlying].del(key, opts, res)));
    }
    async _batch(operations, opts, cb) {
        await this[Store](cb, new Promise(res => this[Underlying].batch(operations, opts, res)));
    }

    async _get(key, {asBuffer}, cb) {
        const [err, val] = await new Promise(res => this[Underlying].get(key, {asBuffer}, (e, val) => res([e, val])));
        cb(err, val);
    }
    _iterator(options) {
        return new Iterator(this, options);
    }
};
module.exports = function FileDown(location, opts = {}) {
    return new FileLevelDown(location, opts);
};
