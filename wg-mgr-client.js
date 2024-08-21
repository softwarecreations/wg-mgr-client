#!/usr/bin/env node

const fs = require('fs'), path = require('path');
const https = require('https');
const { exec, spawn } = require('child_process');
const otherPossibleServicesA = [ 'ssh', 'nginx', 'mongod' ]; // they don't need to be installed on all systems, do not edit for specific systems.

const colors = { red:s=>`\u001b[31m${s}\u001b[0m`, green:s=>`\u001b[32m${s}\u001b[0m`, yellow:s=>`\u001b[33m${s}\u001b[0m`, blue:s=>`\u001b[34m${s}\u001b[0m`, magenta:s=>`\u001b[35m${s}\u001b[0m`, cyan:s=>`\u001b[36m${s}\u001b[0m`, white:s=>`\u001b[37m${s}\u001b[0m`, black:s=>`\u001b[30m${s}\u001b[0m`, gray:s=>`\u001b[90m${s}\u001b[0m` };

( () => { // wrapped for uglify-js
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

  const mkdirIfNotExists = dir => fs.existsSync(dir) || fs.mkdirSync(dir);
  const fileReplaceContents = (filePath, contents) => {
    const exists = fs.existsSync(filePath);
    const oldBuf = exists ? fs.readFileSync(filePath).toString() : '';
    if (exists && oldBuf===contents || oldBuf.replace(/# updated[^\n]+/,'')===contents.replace(/# updated[^\n]+/,'')) {
      // console.log(colors.white(`No change to ${filePath}`));
      return false;
    }
  	fs.writeFileSync(filePath, contents);
    console.log(colors[exists?'magenta':'blue'](`${exists?`Replaced ${oldBuf.length} bytes`:'Created'} file with ${contents.length} bytes: ${filePath}`));
  	return true;
  };
  const makeBashStringExportingEnvVars = envO => { // makes a multi-line bash string exporting environment variables provided by an object, puts an empty line between prefixes FOO_ and BAR_
    const kvA = Object.entries(envO), expA = [];
    for (let i=0, key='', value='', prefix='', lastPrefix=''; i < kvA.length; ++i) {
      [ key, value ] = kvA[i]
      prefix = key.split('_')[0]; if (prefix !== lastPrefix) { expA.push(''); lastPrefix = prefix; }
      expA.push(`export ${key}='${value}'`);
    }
    return `# updated ${(new Date()).toISOString().replace('T',' ').replace(/\.\d\d\d/,' ')}\n` + expA.join('\n');
  };
  const fileReplaceString = (filePath, search, replace, ifNotFound) => {
  	const buf = fs.readFileSync(filePath).toString();
  	let newBuf = buf;
  	if (buf.match(search)===null) {
  		if (ifNotFound!=='append') return false;
  		newBuf += `\n${replace}`;
  	} else {
  		newBuf = buf.replace(search, replace);
  		if (newBuf===buf) return false;
  	}
  	fs.writeFileSync(filePath, newBuf);
  	return true;
  };
  const fileReplaceStringBetweenComments = (filePath, purpose, newContents, ifNotFound) => {
  	const startComment=`#${purpose} starts`, endComment=`#${purpose} ends`, searchRegex=RegExp(`${startComment}[\\w\\W]*?${endComment}\n`);
  	return fileReplaceString(filePath, searchRegex, `${startComment}\n${newContents}\n${endComment}\n`, ifNotFound);
  };

  const getNameLabel = (name,label) => label!==name ? `${name} (${label})` : name;
  const getAutoGenA = ({ vpnName }) => [ '# Do not edit this file',`#This file is automatically generated by wg-mgr-client.service for the '${vpnName}' dev VPN`, '' ];
  String.prototype.addS = function(n) { return n===1 || n===-1 ? this.toString() : this.toString() + 's'; };

  const writeWgClientConfP = async () => {
    const dataO = await getDataOP();
    const { name, label, vpnName, vpnIp, PrivateKey, MTU, serverName, serverVpnIp, serverFQDN, serverPublicKey, ListenPort, otherNodeIpsA, otherNodeNameLabelsA, PersistentKeepalive } = dataO;
    const restartVpn = () => {
      console.log(`Restarting wg-quick@wg_${vpnName}.service`);
      spawn('systemctl', ['restart', `wg-quick@wg_${vpnName}.service`], { stdio:'inherit' });
      exec('systemctl list-units --all', (err, stdout) => {
        if (err) return;
        const otherServicesA = otherPossibleServicesA.map( name => `${name}.service` ).filter( svcName => stdout.includes(svcName) );
        console.log(`Restarting [${otherServicesA.join(', ')}]`); // so they can receive incoming connections from the VPN
        spawn('systemctl', ['restart'].concat(otherServicesA), { stdio:'inherit' });
      });
    };
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
    if (fs.existsSync(clientWgConfPath) && fs.readFileSync(clientWgConfPath).toString()===clientWgConfS) {
      console.log(`No change in ${clientWgConfPath}`);
      if (argCmd==='updateRestart') restartVpn();
      return;
    }
    fs.writeFileSync(clientWgConfPath, clientWgConfS);
    console.log(`Wrote new conf ${clientWgConfPath} client:${nameLabel} that connects to server '${serverName}' and ${allowedNameLabelsA.length} other ${'peer'.addS(allowedNameLabelsA.length)} [ '${allowedNameLabelsA.join("', '")}' ]`);
    // update /etc/hosts
    const otherNodeNamesA = otherNodeNameLabelsA.map( s => s.split(' ')[0] );
    let longestVpnIp = vpnIp.length;
    const allNamesHostsA = otherNodeNameLabelsA.map( (nameLabel, index) => {
      if (otherNodeIpsA[index].length > longestVpnIp) longestVpnIp = otherNodeIpsA[index].length;
      return { name:nameLabel.split(' ')[0], ip:otherNodeIpsA[index] };
    }).concat({ name, ip:vpnIp }).sort( ({ip:a},{ip:b}) => Number(a.split('.')[3]) - Number(b.split('.')[3]) );
    const wgHosts = allNamesHostsA.map( ({ name, ip }) => `${ip}  ${' '.repeat(longestVpnIp-ip.length)}wg-${name}` ).join('\n');
    if (fileReplaceStringBetweenComments('/etc/hosts', `wg_${vpnName}`, wgHosts, 'append')) console.log('Updated /etc/hosts');
    restartVpn();
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

  const argsA = process.argv.slice(process.argv.findIndex( s => !s.endsWith('node') && !s.endsWith('.js') ));
  const [ argCmd, argParam0, argParam1 ] = argsA;

  const isolatedUsageA = [ 'updateRestart', 'updateWgConf' ];
  const showUsageHintsP = async () => {
    const dataO = await getDataOP();
    const { isolation, otherNodeIpsA, otherNodeLabelsA } = dataO;
    const usageA = isolation ? isolatedUsageA : ( isolatedUsageA
      .concat(otherNodeLabelsA.map( label => `mongosh  ${label} <dbname>` ))
      .concat(otherNodeLabelsA.map( label => `mongoenv ${label} <dbname>` ))
    );
    process.stderr.write('Usage:\n' + usageA.map( cmd => `  wgmc ${cmd}\n` ).join(''));
  };

  switch (argCmd) {
    case 'updateRestart':
    case 'updateWgConf': writeWgClientConfP();                  break;
    case 'mongosh'     : mongoshP(       argParam0, argParam1); break;
    case 'mongoenv'    : getMongoEnvarsP(argParam0, argParam1); break;
    default:             showUsageHintsP();                     break;
  }
})();
