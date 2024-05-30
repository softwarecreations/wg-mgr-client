#!/usr/bin/env node

// updated 2024-04-16

// uglifyjs wg-mgr-client.js -m -o ugly.min.js

const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

( () => { // wrapped for uglifyjs
  const urlFilePath = __dirname + '/wg-mgr-client.url';
  const clientHttpsUrl = fs.readFileSync(urlFilePath).toString().split('\n')[0].trim();
  const clientHttpsHost = clientHttpsUrl.match(/(https?:\/\/[^/]+)/)[1];

  const tryGetDataOP = () => new Promise( resolveF => {
    const req = https.get(clientHttpsUrl, res => {
      if (res.statusCode !== 200) {
        if (res.statusCode===403) return rejectF(new Error(`Forbidden, invalid path. Fix ${urlFilePath}`));
        return rejectF(new Error(`Request failed with status code ${res.statusCode}`));
      }
      const dataA = [];
      res.on('data', chunk => dataA.push(chunk) );
      res.on('end', () => {
        try {
          resolveF([ 1, JSON.parse(dataA.join('')) ]);
        } catch (err) {
          resolveF([0, err]);
        }
      });
    });
    req.on('error', err => resolveF([0, err]) );
  });

  const sleepP = delay => new Promise( resolveF => setTimeout(resolveF, delay) );

  const getDataOP = async () => {
    for (let i=0; ; ++i) {
      const [ success, resO ] = await tryGetDataOP();
      if (success) {
        if (i > 0) console.log(`Successfully loaded ${clientHttpsHost} after ${i+1} attempts.`);
        return resO;
      }
      let { code, address } = resO;
      console.error(`Failed to load ${clientHttpsHost} (${address}) ${code}`);
      if (i < 99) await sleepP(5000); else throw resO;
    }
  };

  const getNameLabel = (name,label) => label!==name ? `${name} (${label})` : name;
  const getAutoGenA = ({ vpnName }) => [ '# Do not edit this file',`#This file is automatically generated by wg-mgr-client.service for the '${vpnName}' dev VPN`, '' ];
  String.prototype.addS = function(n) { return n===1 || n===-1 ? this.toString() : this.toString() + 's'; };

  const writeWgClientConfP = async () => {
    const dataO = await getDataOP();
    const { name, label, vpnName, vpnIp, PrivateKey, MTU, serverName, serverVpnIp, serverFQDN, serverPublicKey, ListenPort, otherNodeIpsA, otherNodeNameLabelsA, PersistentKeepalive } = dataO;
    console.log("vpnName", vpnName)
    const nameLabel = getNameLabel(name,label);
    const outA = getAutoGenA(dataO).concat(['[Interface]', `#My (client IP and key) - ${nameLabel}`, `Address = ${vpnIp}/32`, `PrivateKey = ${PrivateKey}`]);
    if (MTU) outA.push(`MTU = ${MTU}`);
    outA.push('');
    outA.push(`#Server '${serverName}' details (and gateway to other dev nodes)`);
    outA.push('[Peer]');
    outA.push(`PublicKey = ${serverPublicKey}`);
    outA.push(`Endpoint = ${serverFQDN}:${ListenPort}`);
    const allowedIpsA = [serverVpnIp].concat(otherNodeIpsA);
    const allowedNameLabelsA = [serverName].concat(otherNodeNameLabelsA);
    outA.push(`AllowedIPs = ${allowedIpsA.map(ip => `${ip}/32`).join(', ')} # [ '${ allowedNameLabelsA.join("', '") }'] respectively`);
    outA.push(`PersistentKeepalive = ${PersistentKeepalive}`);
    const clientWgConfS = outA.join('\n');
    const clientWgConfPath = `/etc/wireguard/wg_${vpnName}.conf`;
    if (fs.existsSync(clientWgConfPath) && fs.readFileSync(clientWgConfPath).toString()===clientWgConfS) return console.log(`No change in ${clientWgConfPath}`);
    fs.writeFileSync(clientWgConfPath, clientWgConfS);
    console.log(`Wrote new conf ${clientWgConfPath} client:${nameLabel} that connects to server '${serverName}' and ${allowedNameLabelsA.length} other ${'peer'.addS(allowedNameLabelsA.length)} [ '${allowedNameLabelsA.join("', '")}' ]`);
    spawn('systemctl', ['restart', `wg-quick@wg_${vpnName}.service`], { stdio: 'inherit' });
  };

  const exitError = msg => {
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  };

  const mongoshP = async (label, dbName) => {
    if (dbName.indexOf('<')>-1 || dbName.indexOf('>')>-1) throw new Error(`Provide an actual dbname.`);
    const dataO = await getDataOP();
    const { otherNodeIpsA, otherNodeLabelsA } = dataO;
    const otherNodeIndex = otherNodeLabelsA.indexOf(label);
    if (otherNodeIndex===-1) return exitError(`Node label '${label}' does not exist. Available nodes are: [ '${otherNodeLabelsA.join("', '")}' ]`);
    const otherNodeIp = otherNodeIpsA[otherNodeIndex];
    const paramsA = ['--host', `${otherNodeIp}:27017`];
    if (dbName) paramsA.push(dbName);
    spawn('mongosh', paramsA, { stdio: 'inherit' });
  };

  const getMongoEnvarsP = async (label, dbName) => {
    if (dbName.indexOf('<')>-1 || dbName.indexOf('>')>-1) throw new Error(`Provide an actual dbname.`);
    const dataO = await getDataOP();
    const { otherNodeIpsA, otherNodeLabelsA } = dataO;
    const otherNodeIndex = otherNodeLabelsA.indexOf(label);
    if (otherNodeIndex===-1) return exitError(`Node label '${label}' does not exist. Available nodes are: [ '${otherNodeLabelsA.join("', '")}' ]`);
    const otherNodeIp = otherNodeIpsA[otherNodeIndex];
    console.log(`export MONGO_URL='mongodb://${otherNodeIp}:27017/${dbName}'`);
    console.log(`export MONGO_OPLOG_URL='mongodb://${otherNodeIp}:27017/local'`);
  };

  const [ nodeRuntime, thisScriptPath, argCmd, argParam0, argParam1 ] = process.argv;

  const showUsageHintsP = async () => {
    const dataO = await getDataOP();
    const { isolation, otherNodeIpsA, otherNodeLabelsA } = dataO;
    const usageA = isolation ? ['updateWgConf'] : ( ['updateWgConf']
      .concat(otherNodeLabelsA.map( label => `mongosh  ${label} <dbname>` ))
      .concat(otherNodeLabelsA.map( label => `mongoenv ${label} <dbname>` ))
    );
    process.stderr.write('Usage:\n' + usageA.map( cmd => `  ${thisScriptPath} ${cmd}\n` ).join(''));
  };

  switch (argCmd) {
    case 'updateWgConf': writeWgClientConfP();                  break;
    case 'mongosh'     : mongoshP(       argParam0, argParam1); break;
    case 'mongoenv'    : getMongoEnvarsP(argParam0, argParam1); break;
    default:             showUsageHintsP();                     break;
  }
})();
