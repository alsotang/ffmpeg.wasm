require('regenerator-runtime/runtime');
const defaultArgs = require('./constants/defaultArgs');
const strList2ptr = require('./utils/strList2ptr');
const getTransferables = require('../utils/getTransferables');

const NO_LOAD_ERROR = 'FFmpegCore is not ready, make sure you have completed Worker.load().';

let action = 'unknown';
let Module = null;
let adapter = null;
let ffmpeg = null;

const load = ({ workerId, payload: { options: { corePath } } }, res) => {
  if (Module === null) {
    const Core = adapter.getCore(corePath);
    Core()
      .then(async (_Module) => {
        Module = _Module;
        Module.setLogger((message, type) => {
          res.progress({
            workerId, action, type, message,
          });
        });
        ffmpeg = Module.cwrap('ffmpeg', 'number', ['number', 'number']);
        res.resolve({ message: 'Loaded ffmpeg-core' });
      });
  } else {
    res.resolve({ message: 'Loaded ffmpeg-core' });
  }
};

const FS = ({
  payload: {
    method,
    args,
  },
}, res) => {
  if (Module === null) {
    throw NO_LOAD_ERROR;
  } else {
    res.resolve({
      message: `Complete ${method}`,
      data: Module.FS[method](...args),
    });
  }
};

const parseArgs = (cmd) => {
  const args = [];
  let nextDelimiter = 0;
  let prevDelimiter = 0;
  // eslint-disable-next-line no-cond-assign
  while ((nextDelimiter = cmd.indexOf(' ', prevDelimiter)) >= 0) {
    let arg = cmd.substring(prevDelimiter, nextDelimiter);
    let quoteIdx = arg.indexOf('\'');
    let dblQuoteIdx = arg.indexOf('"');

    if (quoteIdx === 0 || dblQuoteIdx === 0) {
      /* The argument has a quote at the start i.e, 'id=0,streams=0 id=1,streams=1' */
      const delimiter = arg[0];
      const endDelimiter = cmd.indexOf(delimiter, prevDelimiter + 1);

      if (endDelimiter < 0) {
        throw new Error(`Bad command escape sequence ${delimiter} near ${nextDelimiter}`);
      }

      arg = cmd.substring(prevDelimiter + 1, endDelimiter);
      prevDelimiter = endDelimiter + 2;
      args.push(arg);
    } else if (quoteIdx > 0 || dblQuoteIdx > 0) {
      /* The argument has a quote in it, it must be ended correctly i,e. title='test' */
      if (quoteIdx === -1) quoteIdx = Infinity;
      if (dblQuoteIdx === -1) dblQuoteIdx = Infinity;
      const delimiter = (quoteIdx < dblQuoteIdx) ? '\'' : '"';
      const quoteOffset = Math.min(quoteIdx, dblQuoteIdx);
      const endDelimiter = cmd.indexOf(delimiter, prevDelimiter + quoteOffset + 1);

      if (endDelimiter < 0) {
        throw new Error(`Bad command escape sequence ${delimiter} near ${nextDelimiter}`);
      }

      arg = cmd.substring(prevDelimiter, endDelimiter + 1);
      prevDelimiter = endDelimiter + 2;
      args.push(arg);
    } else if (arg !== '') {
      args.push(arg);
      prevDelimiter = nextDelimiter + 1;
    } else {
      prevDelimiter = nextDelimiter + 1;
    }
  }

  if (prevDelimiter !== cmd.length) {
    args.push(cmd.substring(prevDelimiter));
  }

  return args;
};

const run = ({
  payload: {
    args: _args,
  },
}, res) => {
  if (Module === null) {
    throw NO_LOAD_ERROR;
  } else {
    const args = [...defaultArgs, ...parseArgs(_args)].filter((s) => s.length !== 0);
    ffmpeg(args.length, strList2ptr(Module, args));
    res.resolve({
      message: `Complete ${args.join(' ')}`,
    });
  }
};

exports.dispatchHandlers = (packet, send) => {
  const { workerId, jobId, action: act } = packet;
  const res = (status, payload) => {
    const pkt = {
      workerId,
      jobId,
      action: act,
      status,
      payload,
    };
    send(pkt, getTransferables(pkt));
  };
  res.resolve = res.bind(this, 'resolve');
  res.reject = res.bind(this, 'reject');
  res.progress = res.bind(this, 'progress');

  action = act;
  try {
    ({
      load,
      FS,
      run,
    })[act](packet, res);
  } catch (err) {
    /** Prepare exception to travel through postMessage */
    res.reject(err.toString());
  }
  action = 'unknown';
};

exports.setAdapter = (_adapter) => {
  adapter = _adapter;
};
