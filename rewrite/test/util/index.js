'use strict';

/* eslint camelcase: "off" */
/* eslint max-len: "off" */

const assert = require('bsert');
const BN = require('bcrypto/lib/bn.js');
const rsa = require('bcrypto/lib/rsa');

const testUtil = {
  log(...args) {
    console.log(...args);
  },

  write(str) {
    process.stdout.write(str);
  },

  flush() {
    ;
  },

  showOneResult(name, fails, reps) {
    const istr = [' \u2717 ', ' \u2713 '];

    if (fails == null) {
      this.log('\x1b[92m%sPASS\x1b[0m: %s', istr[1], name);
    } else if (fails > 0) {
      this.log('\x1b[91m%sFAIL\x1b[0m: %s (%d/%d failed)',
               istr[0], name, fails, reps);
    } else {
      this.log('\x1b[92m%sPASS\x1b[0m: %s', istr[1], name);
    }
  },

  showTest(name, just = 32) {
    this.write(`\x1b[38;5;33m${name}\x1b[0m: `);
    this.flush();
  },

  showWarning(warn) {
    this.write(`\x1b[91mWARNING\x1b[0m: ${warn}\n`);
  },

  showProgress(failed) {
    if (failed)
      this.write('\x1b[91m.\x1b[0m');
    else
      this.write('\x1b[92m.\x1b[0m');

    this.flush();
  },

  showTiming(tname, tvals, just = 32) {
    const mean = sum(tvals) / tvals.length;
    const sampDev = total(tvals, mean);

    this.write(`\x1b[92m \u25f7 ${tname}\x1b[0m: `);

    this.log('%d ms, \u03c3=%d ms, max=%d ms, min=%d ms',
             mean, sampDev, max(tvals), min(tvals));
  },

  showTimingTriple(tname, pvvals) {
    const [gvals, pvals, vvals] = pvvals;

    this.showTest(`Timings for ${tname}`, 0);
    this.write('\n');
    this.showTiming('Generation', gvals, 36);
    this.showTiming('Signing', pvals, 36);
    this.showTiming('Verifying', vvals, 36);
    this.write('\n');
    this.flush();
  },

  runTest(callback, doc, reps) {
    const ndisp = Math.max(1, reps >>> 6);
    const parts = doc.split(',');
    const [testName, failNames] = [parts[0], parts.slice(1)];

    this.showTest(testName);

    const fails = [];

    for (let i = 0; i < failNames.length; i++)
      fails.push(0);

    let failed = false;

    for (let idx = 0; idx < reps; idx++) {
      const checks = callback();

      let cidx = 0;
      let c;

      for ([cidx, c] of checks.entries()) {
        if (!c) {
          failed = true;
          fails[cidx] += 1;
        }
      }

      assert(cidx + 1 === fails.length);

      if (idx % ndisp === ndisp - 1) {
        this.showProgress(failed);
        failed = false;
      }
    }

    this.write('\n');

    if (sum(fails) === 0) {
      this.showOneResult(`all ${testName} subtests passed (${fails.length})`,
                           null, null);
    } else {
      for (const [nf, nn] of this.zip(fails, failNames))
        this.showOneResult(`${testName}_${nn}`, nf, reps);
    }

    return [sum(fails.map(x => x > 0 ? 1 : 0)), fails.length];
  },

  runAllTests(reps, modname, tests) {
    this.showTest(`${modname} tests`, 0);
    this.write('\n');

    let fails = 0;
    let subtests = 0;

    for (const [test, doc] of tests) {
      const [f, s] = this.runTest(test, doc, reps);
      fails += f;
      subtests += s;
    }

    this.showTest('Summary', 0);
    this.write('\n');

    if (fails === 0)
      this.showOneResult(`all ${subtests} subtests passed`, null, null);
    else
      this.showOneResult('some subtests did not pass', fails, subtests);

    this.write('\n');
  },

  sample(pop, k) {
    assert(Array.isArray(pop));
    assert((k >>> 0) === k);
    assert(k <= pop.length);

    const out = [];
    const set = new Set();

    while (out.length < k) {
      const i = ((Math.random() * 0x100000000) >>> 0) % pop.length;

      if (set.has(i))
        continue;

      out.push(pop[i]);
      set.add(i);
    }

    return out;
  },

  iterator(iterable) {
    assert(iterable);

    if (typeof iterable === 'function') {
      const iter = iterable();
      assert(typeof iter.next === 'function');
      return iter;
    }

    if (typeof iterable.next !== 'function') {
      assert(typeof iterable[Symbol.iterator] === 'function');
      return iterable[Symbol.iterator]();
    }

    return iterable;
  },

  next(iterable, def) {
    const iter = this.iterator(iterable);
    const it = iter.next();

    if (iter.done) {
      if (def !== undefined)
        return def;
      throw new Error('Iterator is done.');
    }

    return it.value;
  },

  *enumerate(iterable) {
    const iter = this.iterator(iterable);

    let i = 0;

    for (const item of iter) {
      yield [i, item];
      i += 1;
    }
  },

  list(iterable) {
    const iter = this.iterator(iterable);

    const items = [];

    for (const item of iter)
      items.push(item);

    return items;
  },

  *cycle(iterable) {
    const iter = this.iterator(iterable);
    const saved = [];

    for (const item of iter) {
      yield item;
      saved.push(item);
    }

    while (saved.length) {
      for (const item of saved)
        yield item;
    }
  },

  *chain(...args) {
    for (const iter of args) {
      for (const item of iter)
        yield item;
    }
  },

  *zip(...args) {
    const iters = [];

    for (const iterable of args)
      iters.push(this.iterator(iterable));

    while (iters.length) {
      const result = [];

      for (const iter of iters) {
        const it = iter.next();

        if (it.done)
          return;

        result.push(it.value);
      }

      yield result;
    }
  },

  rsaKey(p, q) {
    assert(Buffer.isBuffer(p));
    assert(Buffer.isBuffer(q));

    const n = new BN(p).mul(new BN(q)).toArrayLike(Buffer);
    const e = new BN(65537).toArrayLike(Buffer);
    const key = new rsa.RSAPrivateKey(n, e, null, p, q);

    rsa.privateKeyCompute(key);

    return key;
  },

  primes1024: null,
  primes2048: null
};

// Some random primes for testing (saves time vs generating on the fly).
testUtil.primes1024 = [
  Buffer.from(''
    + '50231a89e29c993030482ae715f6ee967460d356b797a85771f5df8db434'
    + 'b434bdcda3b6b2e15dc4827b85e75451a145a622735417c7b082a2b75c06'
    + '5c06dba4965194485569aa36f96ffd98c3435b7d0541f39c81e93dee8d83'
    + '8d83e3755ca7254e4c7c1dc1c7acf55b236cef78b1cb9e38e52da045c9d8'
    + 'c9d892f6731dcebda00f05427d4f3c97', 'hex'),
  Buffer.from(''
    + 'e3fef642f78b17f50e3688df6fc419f3355af8a5b50064ba7b0ff5aae095'
    + 'e0950b87440a4009722fad7cae9a5ab9c21e94f6260f046bccd88b8938e5'
    + '38e5bf7dc05b84a09758e74ce3a6b56e5d222a2271e84caaf6c1710a4f57'
    + '4f57be711116bb630d3584590aa3665a02e70afa61a01ce010ccea87a83e'
    + 'a83e9ab6e3bf7011800a460b37c98ebd', 'hex'),
  Buffer.from(''
    + '4b3b1a1b700b2c5b85084fcb547cc93098e173e7552251e529cdf0b9015e'
    + '015e6fe914fd188e6c9fc499dc070db1ed5798fe7338ba980bcb19a09180'
    + '9180d4025e70ad48636f49c746a3cb9186103f328f6c3f2c791145234c33'
    + '4c33e3212872fb9fcc1c033bba15c5b96c9622f8669b1597a6dbb935f2e5'
    + 'f2e59e4dd998215ae25d9caae513d691', 'hex'),
  Buffer.from(''
    + '2be29c388e64b2b650ebaa6a404efec3c2c4c485ab2538a6f71e34d09d3d'
    + '9d3d6b4273020ccc0aed1781238fb90c2062f02f16f9fdde71a9eae66b73'
    + '6b7357dc7a624921090428a85fde35b13eb185bd314b75ede2fbdd4ac1a7'
    + 'c1a7620ed884914f9be6474085c395fa3c23a93404c5c113fffe0853c82c'
    + 'c82cad367d4b71e94bfe67ded1ddddd9', 'hex'),
  Buffer.from(''
    + '478941747c630424eeb355c82a533bf1b4d2baa801c7b2db3c1e83a71e02'
    + '1e02ba028f50a0a536717f3c58edd12c5fb036bbcc76a4a83ba19cd552c7'
    + '52c7f04436a2a4d5f888c3369f15c738a3565f66f18e54006c30952097d3'
    + '97d3e26ec8feecf48987cbd81f7fb718d8c7af335931baf30db3d0c2e129'
    + 'e1296e9002f91b66a7a2159ca90fc53d', 'hex'),
  Buffer.from(''
    + 'ec6e068cbcd4edbe70abe9f09c8055a5feeaccc3c0f6a0d45f44d43cb9b4'
    + 'b9b4312c2c467f4d55b8d563f5f979d81f55ec7f229cb117d9070fc68c30'
    + '8c30712d2814be96c67959cbfd0cebdc4802a0788e79dd5d150887d44db5'
    + '4db5df2c0fbe183b64e7197cac8cb3759058f476a8aa161a02b8fdd9760b'
    + '760bc6401809417f5ad7d2a2df4f224d', 'hex'),
  Buffer.from(''
    + 'ab7f423ce6409f205dff95d329b91d7a3d22bf335de95dc86495376be8f8'
    + 'e8f8ff25a68b410737bd5314e322a1d80ab304fd4350d4fc2965353188f4'
    + '88f4034818bb56636948d61e46c0a05c672908265ae66a52e9b15cc7639c'
    + '639c10a43d8021df0a34f367559c8ff2410faddfa9a6efd1077cad08f8d5'
    + 'f8d527f22a14e3f766bbb7a3b5d5d233', 'hex'),
  Buffer.from(''
    + '9e720cdeee2b64a2a47746d4a7824fc086c71e7de6a69fc4bc7988644a10'
    + '4a107900ce8d00d4559454cc40874cb0ea736ceaded0f9fc77c68501d113'
    + 'd113a5311e7bf3fc78ca14eb7fdaab10f6cce4db0bd22bb8b5790cc15918'
    + '59184cff0d77b50a6c972fa5d61158fda17201bcb126ee33459b06ac7428'
    + '7428f1b571087d9a9e833acbabd2de09', 'hex'),
  Buffer.from(''
    + '8db06ff30beba17fafef2f001ea6b9b7bd114b5ffcbfa4e990f0eb5eee19'
    + 'ee19b2aca0e3260fe550748940e8c1e9ea09f6fdd7f4e5fe326542e37b12'
    + '7b1280016679c2ede25ccc36bd769cb261ca3412de55a9fd765092225523'
    + '5523fa7791b27b37271973d3ae2e003ea18337621fb83916b967860ae943'
    + 'e943410f14ed9f1133a2b4ec79e2e2c3', 'hex'),
  Buffer.from(''
    + '3326b19be59af3b0a81a0c3ca95d20623bfcf8722d44d6136cbdc364b7b0'
    + 'b7b0911addac7ab792438830e848f2fd7744d9c5201584764144af8544cb'
    + '44cbcc95e3b571fe1ce07a83e020f5bb00a0e510f936f051bdf6b3e78d7b'
    + '8d7b119c1ea3ef952698c7e2ea656d099eed8312e0037167286c9ea7de85'
    + 'de855eadbe1e209781be0a1328662ff3', 'hex'),
  Buffer.from(''
    + '6df273ba88b3027aa916f764182c0f1669ef68c35d23d8c60a9a3a0f22e0'
    + '22e0beb7e3ab8b710508eb02b5b2f5619686a47fb11ebc323801f1a01a30'
    + '1a3049d9e534ece87b87db43392ff31a9dc55cccaa98660731ea9a9db1bb'
    + 'b1bb703214f1509e2a2fad86573335d760a8a3b0b9378d7857ae04355f3f'
    + '5f3f7a9f9a912ea17116e243e584e199', 'hex'),
  Buffer.from(''
    + '1ddf1cb3f83ca0f32433ce65bd0d01bd10fa4bd956b906a6e7eda99c65c3'
    + '65c3072c2f9ad7816dcb539b7ddc714d644254ca081c6e789ff8f427243d'
    + '243d238d885880da521a2ade6ab822b7b9f63a6a8804cefbc5bebb217761'
    + '77619153d4804e751d3875e3879931477b8bfeff3fc052708907395a46ab'
    + '46abe8924f52ab8facfaf263ae15ab9d', 'hex'),
  Buffer.from(''
    + '5c44ac04e2b1a4176c55e4dda08f7e1063369eefd4c0eb8a3565133fa7d1'
    + 'a7d1d9124bd0b0cf775b269c55b27ceaaf81fba9c589853f5ce569288761'
    + '87617678a5333cbf394d4732b04732b1f12a1beb95740f053d70940a897c'
    + '897c039a1bfdde71b998682915581195be4e12544c05dc8aff8420b65e04'
    + '5e04aec5409e07667a306f1574a09bc3', 'hex'),
  Buffer.from(''
    + 'd0673042271520b54e285c471fcbc685bcf5e1067f1db117e67737d562c3'
    + '62c3bff0665816fec08cd34237f0d16116d8be430dfe235a2a9382f21bea'
    + '1bea13b20e82705bd796e4d57204384159b3d4b5ce7603325f49951feaa6'
    + 'eaa61eaeff21fad59e992833102f2401e5bf89af06edcbe9c3b997ba2299'
    + '2299402f85dab795883a25f32876bf49', 'hex'),
  Buffer.from(''
    + '0f3c1f8f4f621b299b4e3b071568cb7a4f385ce7236d9839589a7900e56d'
    + 'e56d642aeacc743582e4a4dddcce394bac83450ccca9df29ddef94a044e9'
    + '44e965bae0f15035a652a8578cf61382506a3e423b34e74f84f69dba006e'
    + '006e8a495e533ad29b7084b3200449ad7eb1b4725ab4900d6be7f799d068'
    + 'd06814c8f229ece0990fa8af7ad5339b', 'hex'),
  Buffer.from(''
    + 'ce194d7e647744cbe9729b0c06e9b582998f8eef7a011c65d15ce0027f9d'
    + '7f9dfde6d1ac1d2a04f4bf5f128c24fc6193e550e567aac78995ca6428bb'
    + '28bbe0cfe65fad04b402f682ee7d2c7a32826cb29042257f6d2f2a2edbee'
    + 'dbeeb2b322a27c725095da4d0412960944eb65f7416a8c5feb89e24b80f4'
    + '80f4422c2a2d8c0b67b2f160a1495573', 'hex')
];

testUtil.primes2048 = [
  Buffer.from(''
    + 'ccbf79ad1f5e47086062274ea9815042fd938149a5557c8cb3b0c33ddcd8'
    + 'dcd87c58a53760826a99d196852460762e16a715e40bee5847324aa19911'
    + '9911e98bf58e8c9af65e06182bb307c706069df394e5d098fbe85701eb2e'
    + 'eb2e88089913834aadba3b134f646f6d48f2dacba00a5bfd15e8b8d9c0ef'
    + 'c0efe1f4209595b920691aeebfc4ba1b28592d88fc0f565b0d3dbcf2e3dd'
    + 'e3dda7b02e5452660c4bd4485e23cb68e1fdc9f3647f85c5ee0c3555c21c'
    + 'c21ce8307320257fae148887af5412db2cece240044cd668c72c7219b2e6'
    + 'b2e6a32f5da0e0cd52ec9078e7ef521461f2fe5d83b240c4125079610512'
    + '0512976d1c3b65fcb0ad75133012e2c7329ce55177556f07bdabb2716224'
    + '622466fb', 'hex'),
  Buffer.from(''
    + '842d18ae53b1e47aac1d2c7ff91ee656f669ce9676edc2689f39b2cd3052'
    + '3052c9157e65b16241bb9d6eb0d15adfb4baa97a7f6f4b9d0621ef84d1ba'
    + 'd1ba262f5b3b98ec7b47a5492631e282ade5108d02fc14c965d9dbfd4683'
    + '4683f740abc8f9120d0c7e2f79b0c94f68f0c91acdbd977a66f9a9e159e6'
    + '59e680ec12ba632ed36f54f438e0eaefc24b6e25c6fd32da9a9c92710ced'
    + '0cede05462335178baa574e2519aa0bd55a69e5ca130405174271afe9b92'
    + '9b92ad5e82c5ceae9f9124f1b361e22503ad1ca0bad526a2eef833ad84ef'
    + '84efc4203137b10704bab5ce6bb2eb58a2209ef738c44b7127655ed937c5'
    + '37c5a937ae6ac9beaace7ece9fb33ae60e980da73730a6144e38ca9a537f'
    + '537fe02d', 'hex'),
  Buffer.from(''
    + '725ae73d4e5cb87d3b674f019f98bd012b71e585a053d91833b7770fc83b'
    + 'c83bbe4969e391d873d680725eaf76f918d76dce2c5eb810af353b1f5958'
    + '5958beb8bf23390bdde4836ade13d92d21ec306d22e4079f5d71514fe4db'
    + 'e4db4a439b45ee7a8b5251500e98d4e8f20c2a249db33daa52ce257fcbd5'
    + 'cbd56584ee384cf520fbdf29e2d9a9ba4d546e2da7c381ae66dc85f9157f'
    + '157ffadc675fe88456bc882ad49ab778c215de55e851d6513911e99a6753'
    + '67539852fcc7adcdadc073dda3336d7c9912c1033f5c418a5fb74f064b91'
    + '4b91409570174dfdc34000a9da3dbbeb0fbf05c8025c72cdc99cf4ee0a27'
    + '0a27ed0001b6b286140712115d4c836e7cbce248821ce9eb8cb9f4877d7f'
    + '7d7fb7b5', 'hex'),
  Buffer.from(''
    + '91cb1a275081c430cbd7705459f3db2ea1b4763e9efaebde48ad4f2d592a'
    + '592ab1f5df918a5bcab9af35e4d709c371c86dcc61a14cfc2da93c3aa7c5'
    + 'a7c5c87e7cd34317832418c10dc36eab441ed8e6809e92413892a5f630be'
    + '30be54203d3f7b6d139377bc14781835a624c7d040286104664817465c7a'
    + '5c7af1c6c296293e95d9f5696e860492138491b000db7a43d4cce5c6c01d'
    + 'c01d61b080970363929201d8ec7a0f24d5de60d0a3d10128a3531ca11ecf'
    + '1ecf615718bebfe184feb04ff1f4f882313ced7750017165c9f9bc815698'
    + '5698ef269fc3ae0d621be4678490f9dacc8c8daae1a2ca60d98841f12e65'
    + '2e65befcd58796132d9d4debf73eadab889f32b74e6354fc20716090c3da'
    + 'c3daa507', 'hex'),
  Buffer.from(''
    + '29d393bed0ab37a0d913fcc4efbd756967f4a251b904f3f1d22dad4cfaf4'
    + 'faf42e71ff16d50ddf9c6fcc09b5607606f64ee36bdbb03da8591d32e1e3'
    + 'e1e3c473c116b454363d568b278a0c93763e93842e56db6df7cd53df52c3'
    + '52c3c646e372906d5b31af0a977c6f1cf388cda9aacf520d339a7f4352f9'
    + '52f991780f8f8692f0b5c1ba75bc7fb2a4747865c970c9710848b0a9072d'
    + '072d7aee5be20d9fc05daee109813b2edd9c3b7885e036ddd3461f086c79'
    + '6c7990377229194735d974531c113ec67e94878111294a9a5b8b8f416d10'
    + '6d10734e96324ff0722073336c2c552291f91fe638c621e4f5dbc95733ed'
    + '33ed225e63dd73614d7da9e9521c4ba275a6d121d976b8e9f65015465323'
    + '53238621', 'hex'),
  Buffer.from(''
    + 'b38edcaca984c3e2d6ee298d62e79c9f8d2fb54c30e92cf27565a7b3687a'
    + '687ae1ab752c2225be6465c248e000b934bdb4e062d7fc09c201f19ae55d'
    + 'e55dc0388aea176a668da7fe1c59a02ca9fbd2810944d7dbac05f8e02d5b'
    + '2d5b215b7e79fc93b7a686f92bc33efcc354830e9955d946035aef646071'
    + '6071ce9643047859bfa9c4a89ac86c8dde377bf1e6926f5c4778b4ff6067'
    + '6067cbdd30618c1a6d9d986e376074062ba39311643a241ada85e11aa5a6'
    + 'a5a6f92c8ab5b29c471ef1d8c228dbd6a94c2e6811b862c45de4e6f13334'
    + '3334c77ae5385c32f9670815a52b956d20e874cbe88a4f8444e5fe2db694'
    + 'b694b74ca7bd09a09642b6edf7b211ee1dcf7b905afcdd77ffa77b9611df'
    + '11df170f', 'hex'),
  Buffer.from(''
    + 'f87e97ef263c26829d7be5e52af624b50ac0172909f6411842dde7d85555'
    + '555548f734538e415e1db593ad15aeeafcbffeba6140aa1c2a84dcef2dc8'
    + '2dc8594b9d6fe6d45b8c66ac99c51924e19384ef0487c80b5ed17b33c8d5'
    + 'c8d5f38dc35b8a0dabdc99e5f9dcdd6aff87c7ac82a07b59a935282625d7'
    + '25d7171b7c2ea1e98e7b9536f2572d297b1ad3651edecc7c016f1123f418'
    + 'f41868a88f064ec4bbf863b8ed1234fe46873ae1bf5b1554b01e6eebf3a1'
    + 'f3a115b71e33f4c51ec1abd7ed86c34b9e70df854ab94893822e4af2ece2'
    + 'ece2745f61758eba27a8ae6970d968baf37ce5554bee8eabd3aabc35f32f'
    + 'f32f449baf04ad4695ee06dbc2cdfed22a15e5de163bcdf7ecfeecb9d90f'
    + 'd90f6d2d', 'hex'),
  Buffer.from(''
    + '4de02a4a9fb81c07d58edc57213b174cc8c8b171c36b4e0ba1e54378ca49'
    + 'ca497cc785399fbd32ebaaa8b0237e5aa16ac3fa99b3c4369fedff1436f5'
    + '36f50a787dc249f42dad6189e879b412bac26a0d785e1555283a04086862'
    + '68621ebd2bc3281cf8f89ab6e86541739aadd205ee8ad7b8a474881c9576'
    + '957657a5c3a8d76474b64110f44450e815d4c63cb1841bdc7ba98b2284e7'
    + '84e7d01fc270c023e37907ef94bb5250b90411ea7af65443939c39de9353'
    + '9353ff250b190b9122969a545986ebd27514d3fd9df8bd6280ecc4ad0208'
    + '0208e857f14be9671906fed5c3bd501606d2c062f13bc699654cab5de0d2'
    + 'e0d23631bf895d0b6a6263aaf17dbb72baca4426cae93e0edce74baea329'
    + 'a329d7e1', 'hex'),
  Buffer.from(''
    + '821c6fa123511e67a096681f3b5e5329c858d60877b63848df374ea6bc62'
    + 'bc629d2795a14e8824ffd4810701060340e19bf3ebfe57e8711ef252fcb0'
    + 'fcb08608ace03d73850819bbc8411929e2153723a3f83189457fb7481cf4'
    + '1cf40588a0ccc46d950e455a2a7f193fad9b10cc57d3074b9b3a94127388'
    + '7388d25c72ea41e231c8cf297f13238fca882d0756b182ab1d6274f321a6'
    + '21a61c6dd2738bec25fd8051245a8c29fc090888c2316ef55eb065a54ddd'
    + '4ddd704771d5f54ea93f5c18e5237e382d4c32d2d3f5ad22ed673ce3b70b'
    + 'b70bbe5168fe3d6b2316dd3aca4274d6c53886db2316c70bcaa9b931819d'
    + '819d10143428c3f3a6306b1254e2e792f2a5ae5eb8bd99c463ec8d68b429'
    + 'b4290bcd', 'hex'),
  Buffer.from(''
    + '606fc8d62d6698d2d5240ea841163f3aaf08647c8de3f439bf5796d99159'
    + '9159b4f6d8a6c76861dafa6698096175dfefc215a4c6f878f36463a9d858'
    + 'd8585c3c2d44e21436f43471bfb52934a3d793543afb2d84b775d81b046c'
    + '046cb5ce6d6b17e50c042ef9f8406058e96bc14ad4f37d0ca9faf55bcd36'
    + 'cd368a34a96631807ad2acae5824daa68ac1a93cacf0ec9404f07108972a'
    + '972a2bbf0d7c048addeb212a4481a98452149b7e5cf01927e302dfb34db8'
    + '4db8b525ffc971d7ac13365a3c68fee48a6600f3811e9645ea9c6e9779de'
    + '79defccd9a4c12ff536addb8ffefc25666a30fe86208f760320a404034d4'
    + '34d48d887f75ed2034f2fd183c38c8592e34ff44b44ddb3c53e69af70982'
    + '0982cf07', 'hex'),
  Buffer.from(''
    + '19a48e3e0400c3212490f076b661cff2518582dc55813fde8c44c0207a0e'
    + '7a0e399da2284e7e0bc9d0b2d34d4a0a60098eea94242bc21fa85390f8ad'
    + 'f8adb88b419ad218734ebe2356096e08b9fafeb0c438e7b877b975940c46'
    + '0c4603342ea2f7969e3ef0ec32df3f6ebf577fff3458fa968ad7027a190d'
    + '190d9f32d1110db87b1acccb2fb9a05996fb7524188c295ab9a2c06aaa1e'
    + 'aa1e55a416a9d0c8445b49133cd21a0c10d34b020e9ab3a7693226f0ceca'
    + 'ceca5338069d420ab77b03868bd374fb50ea77ef61a294bef16dbecee698'
    + 'e6983f83d069c96ac0c17bf3c80eebb57f8ddd4538ad1fa62ec1110faa04'
    + 'aa04199ffa94819da9ebb8262723762fe18e195a6518abc408f688f11266'
    + '12669cf1', 'hex'),
  Buffer.from(''
    + 'bc850511e19ab100053a5a8e511d096bb840bf1157bb85188491e1d5a571'
    + 'a571d6d077f686fdc609b2f36dbcb0aad5817f785b346b9b87290de8f79a'
    + 'f79a06e0ea3d52cf3972a7453ceaa2ffc6ab706bd292aed9a595fa45726f'
    + '726ff8aa7e7b0433e29e0936ea3997cf47c61288798604f4e38daf40bec1'
    + 'bec174a2223f6352a93acb63d92df690b2995a4a92cd61cb8e6c0a902918'
    + '29180efe8f5b32fc57744c7fc2f5110a04b59b9b76fa8a29158a2647feb8'
    + 'feb8ab6f299eda1b61e3911508a0e9412142dca880e675a16f18cdab4f1d'
    + '4f1d2a3e8f7335320666ca48f7b54c778b137f144859e89d476a17e79443'
    + '94434dca2a7814ec46754db4b6179e0fa32e01a18fdff1b61cdccd184336'
    + '43365675', 'hex'),
  Buffer.from(''
    + '211e072f71e44c8184c66756e62367d6fa43e51ff528d0b1afd0686e7809'
    + '78093c3ca59c51c70cd94969e98d4e1027167990d214a44416ef75f10f49'
    + '0f493fcc9dce5bf9261e7e660ed0a17cc760314c74a8ec89357b2896a8fe'
    + 'a8fe3ec46fffe10e59d73f0f01bf7ce81958c15873c05bfc20d79431f1b0'
    + 'f1b09e6f21d33e8728e6c7377a926c8015b407c29a6ff6cd7fedf784470f'
    + '470fdca282030846cbb807489cd7ed92c0ce465e675577cd6004c462d944'
    + 'd9449c8c0afe38b756133e9b2e1cacd2cb4f7069b022dd1fdf7bbb221ddb'
    + '1ddb1897b00519203c98fc3334db1e0ec73d41bda9453b67e9550a650170'
    + '01708fb256a833896ed899f3d0f5f93927e81447db4f7f399b6a0f1f2f35'
    + '2f35038f', 'hex'),
  Buffer.from(''
    + '6aed5e7e77a0d5d6bb2ffd939e6fd62fe24f1f50bf7c768b73f151d5a561'
    + 'a561e0178ed20e113ef0a8bf1dc2a2c0fcfa097e54c2b3d095def485d00d'
    + 'd00dd87e03abf7e099db46870db4294d03bd2f2e3a96d757a6e2f58b5043'
    + '504330b8b0478ed1662555a911899e859d356be177c5f4a05789743f1ecb'
    + '1ecbda0d35828bae221103851afc15acbf133c3d2a45d817aaafef955faa'
    + '5faac43ef00cf941a76e08d6258cf530b90e5ae8f29b2e386d9053d269fd'
    + '69fd17ac7ab0775ac37c8fb92df6176364dfad81f6c46801c2c857b204a4'
    + '04a449ed6de7217a063cfd5967bdae2ac87e75768aa93cbd60eb3821c183'
    + 'c183258f28a8e0c1dbe5a095ba25b74bf538d1fed2c4b564f2dd04032f1d'
    + '2f1d67f9', 'hex'),
  Buffer.from(''
    + 'b8c9c5180615b5d1b2155626a88e48d67c69997165f2ee4e7af92c66802d'
    + '802d92b7158d222350bcbac3cc46745e4c9eeabc62df8f79b4df18afb3e2'
    + 'b3e2e191740a4845bef34e589d58793255db63103c7d810873bded17c43f'
    + 'c43fc00db9e915440a12b563313d2435d248eeb59579fc85ad7f65949b1a'
    + '9b1a05a3b353f151398147b2cab4c232b5d4119ef0cae6c4f509f3a55aaf'
    + '5aaf28d781414d67e8d2f50c5a1799f938deab1b9a49c2e853ebd6d1a17b'
    + 'a17bd74a22c6f31a4867783c2e80fceb9a4a92815be4f27295a6aa60c617'
    + 'c617901aca2f051722da53833d7e5690a1112d33d6d89aaa1755390b1d43'
    + '1d4370bc0350720bd6fb9e920fa24998cdc395419f4e266b2a2eeedf971f'
    + '971fc7bb', 'hex'),
  Buffer.from(''
    + '3dc4959866d39bdff5c0012be4f53e3877267a8d8446e0e078de86d3f203'
    + 'f203231c3dfe392fd375c75e9147741304ad686fbb4b27a0fb5e07d91e86'
    + '1e867af233735420bbdf30134dad46d6dd5dbe99be8d567d2713e9840973'
    + '09737a43473dcf9d106fcd6e3307c42510197b0f539769791303d4bdd597'
    + 'd597364d2022c577f33be0cea86edaa33b8ef050c57aa68cecc97c1726f1'
    + '26f1fe87f59971b260f72d7ead38cabb61cfc3fea65d7b71d146bfe6f03e'
    + 'f03ec1425b5fb6a0748959b8f490a8272daa3c65649f26605a27795b1fed'
    + '1fed5e0e061dd69c46065b1728a2a16ad335ee9fc076553a2fd3fe7b978f'
    + '978f1dd07a394dc0733c29a7600406aea354f2a588dde271f95a07d48eb3'
    + '8eb33883', 'hex')
];

function sum(iter) {
  let ret = 0;
  for (const n of iter)
    ret += n;
  return ret;
}

function min(iter) {
  let ret = 0;

  for (const n of iter) {
    if (n < ret)
      ret = n;
  }

  return ret;
}

function max(iter) {
  let ret = 0;

  for (const n of iter) {
    if (n > ret)
      ret = n;
  }

  return ret;
}

function total(tvals, mean) {
  let sum = 0;

  for (const tval of tvals)
    sum += (tval - mean) ** 2;

  return Math.sqrt(sum / Math.max(1, tvals.length - 1));
}

module.exports = testUtil;
