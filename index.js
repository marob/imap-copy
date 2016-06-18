var fs = require('fs');
var log4js = require('log4js');
log4js.configure('log4js.json', {reloadSecs: 10});
var loggerSrc = log4js.getLogger('imapSrc');
var loggerDest = log4js.getLogger('imapDest');
var config = require('./config');
var Imap = require('imap');

var reconnectDelay = 5000;

var destReady = false;
var untreatedResults;

var tryReconnectSrc;
var tryReconnectDest;

loggerSrc.info('Starting...');

var imapSrc = new Imap(config.src);
imapSrc.on('error', function (err) {
    loggerSrc.error(err);
});
imapSrc.on('end', function () {
    loggerSrc.info('Connection ended');

    tryReconnectSrc = setInterval(function () {
        loggerSrc.info('Try reconnecting');
        imapSrc.connect();
    }, reconnectDelay);
});
imapSrc.connect();

var imapDest = new Imap(config.dest);
imapDest.on('error', function (err) {
    loggerDest.error(err);
});
imapDest.on('end', function () {
    loggerDest.info('Connection ended');
    destReady = false;

    tryReconnectDest = setInterval(function () {
        loggerDest.info('Try reconnecting');
        imapDest.connect();
    }, reconnectDelay);
});
imapDest.connect();

function forwardMail(mail, seqNumber) {
    loggerDest.debug('Forwarding mail #%s', seqNumber);
    imapDest.append(
        mail,
        {
            mailbox: 'INBOX'
        }
    );
}

function fetchAndForward(results) {
    var f = imapSrc.fetch(
        results,
        {
            markSeen: true,
            bodies: ''
        }
    );
    f.on('message', function (message, seqNumber) {
        loggerSrc.debug('Treating mail #%s', seqNumber);
        message.on('body', function (stream) {
            var mail = '';
            stream.on('data', function (chunk) {
                mail += chunk;
            });
            stream.on('end', function () {
                forwardMail(mail, seqNumber);
            });
        });
    });
    f.on('error', function (err) {
        loggerSrc.error('Fetch error: %s', err);
    });
    f.on('end', function () {
        loggerSrc.info('Done fetching all messages!');
        untreatedResults = null;
    });
}

function unseen() {
    imapSrc.search(['UNSEEN'], function (err, results) {
        if (err) {
            loggerSrc.error(err);
            throw err;
        }

        loggerSrc.info('%s unread mail', results.length);

        if (results.length > 0) {
            if (destReady) {
                fetchAndForward(results);
            } else {
                untreatedResults = results;
                loggerSrc.info('Untreated results: %s', untreatedResults);
            }
        }
    })
}

imapDest.on('ready', function () {
    loggerDest.info('Ready');
    destReady = true;
    clearInterval(tryReconnectDest);
    if (untreatedResults) {
        fetchAndForward(untreatedResults);
    }
});

imapSrc.on('ready', function () {
    loggerSrc.info('Ready');
    clearInterval(tryReconnectSrc);

    imapSrc.openBox('INBOX', false, function (err) {
        if (err) {
            loggerSrc.error(err);
            throw err;
        }

        unseen();

        imapSrc.on('mail', function (nb) {
            loggerSrc.info('%s new mail', nb);
            unseen();
        });
    });
});
