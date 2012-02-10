var sys = require('util'),
	temp = require('./tempfile'),
	url = require('url'),
	fs = require('fs'),
	child = require('child_process'),
	crypto = require('crypto');

var sessions = {};

function ScriptExecuter(type, lines, paths) {
	//console.log(arguments, type, lines);
	var fn = function(){ console.log('Invalid type specified'); };
	if ( type == 'ps' ) { fn = PowerShellExecuter; }
	if ( type == 'cmd' ) { fn = CmdShellExecuter; }
	if ( type == 'bat' ) { fn = BatShellExecuter; }
	if ( type == 'py' ) { fn = PythonExecuter; }
	//console.log(type, fn);
	return {
		run: function(stdout_callback, stderr_callback){
			fn(lines, function(out, err, exit) {
				if ( err.length && err.length > 0) {
					stderr_callback( exit, err);
					return;
				}
				stdout_callback( exit, out );
			}, paths);
		}
	}	
};

function ProcessExecuter(cmd, args, tempfile, lines, callback){
	args = args || [];
        console.log(cmd, args.join(' '));	
	fs.writeFile(tempfile, lines, function(){
		var shell = child.spawn(cmd, args);
		var out = '',
			err = '',
			exit_code = 0;

		shell.stdout.on('data', function (data) {
		  //console.log(cmd+' stdout: ' + data);
		  out = out + data;
		});

		shell.stderr.on('data', function (data) {
		  //console.log(cmd+' stderr: ' + data);
		  err = err + data;
		});

		shell.on('exit', function (code) {
			//console.log(cmd+' exited with code ' + code);
			exit_code = code;
			//console.log(out, err)
			callback( out, err, exit_code );
			//fs.unlink(tempfile);
		});

		shell.stdin.end();
	});
};

function PowerShellExecuter(lines, callback, paths) {
	var cmd = '';
	if ( libscripts['ps'] ) {
		for (key in libscripts['ps']) {
			cmd += libscripts['ps'][key] + '\n';
		}
	}
	cmd += lines;
	
	console.log(lines);
	var tempfile = temp.path() + '.ps1';
	var psexec = 'C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe';
	return ProcessExecuter(psexec, ['-NonInteractive', '-ExecutionPolicy', 'unrestricted', '-File', tempfile], tempfile, cmd, callback);
};

function CmdShellExecuter(lines, callback, paths) {
	var cmd = lines;
	
	console.log(cmd);
	var tempfile = temp.path() + '.bat';
	var cmdexe = 'cmd.exe';
	return ProcessExecuter(cmdexe, ['/C', tempfile], tempfile, cmd, callback);
};

function BatShellExecuter(lines, callback, paths) {
	var cmd = 'SET OLDPATH=%PATH%\nSET PATH=%OLDPATH%;'
	for (var i=0; i < paths.length; i++) {
		cmd += paths[i]+';';
	}
	cmd += '\n';
	cmd += lines;
	cmd += '\nSET PATH=%OLDPATH%\n';
	
	console.log(lines);
	var tempfile = temp.path() + '.bat';
	var cmdexe = 'cmd.exe';
	return ProcessExecuter(cmdexe, ['/C', tempfile], tempfile, cmd, callback);
};


function PythonExecuter(lines, callback, paths) {
	var cmd = '';
	if ( libscripts['py'] ) {
		for (key in libscripts['py']) {
			cmd += libscripts['py'][key] + '\n';
		}
	}
	cmd += lines;
    console.log(cmd);
    var tempfile = temp.path() + '.py';
	var pythonexe = 'c:\\python26x64\\python.exe';

	return ProcessExecuter(pythonexe, [tempfile], tempfile, cmd, callback);
};

var libscripts = {
	'py': {},
	'ps': {},
	'js': {}
};

var http = require('http');
http.createServer(function (req, res) {
	var params = url.parse(req.url, true).query;
	function wrap_jsonp(msg, callback) {
		return	callback+'(\''+
				msg.replace(/'/g,'"')
					.replace(/\\/g,'\\\\')
					.replace(/[\n\r]/g,'')
				+'\');';
	}
	var doDone = function(msg, error) { 
		//console.log(msg); 
		var cl = params.success;
		if ( error ) { cl = params.error; };
		res.end(wrap_jsonp(msg, cl)); 
	};
	if ( typeof params.instruction != 'undefined' ) {
		try {
			if ( params.instruction == 'loadpsscript' ) {
				var libtype = params.type;
				var urlObj = url.parse(params.url);
				var httpClient = http.createClient(urlObj.port, urlObj.hostname);
				var request = httpClient.request('GET', urlObj.pathname);
				request.end();
	            request.on('response', function(response){
				var source = '';
				response.setEncoding('utf8');
				response.on('data', function(chunk){ source += chunk; });
				response.on('end', function(){
					console.log( params.url, response.statusCode )
					if ( response.statusCode == 200 ) {
						if ( ! libscripts[libtype] ) { libscripts[libtype] = {}; };
						libscripts[libtype][params.url] = source;
						doDone(params.url+' loaded');
					} else {
					 	doDone('No such url ' + params.url, true)
					}
				});
			  });
			  return; 	
			};
			if ( params.instruction == 'lazySession' ) {
				var hash = null;
				while ( ! hash ) {
					hash = crypto.createHash('md5').update(Math.random().toString()).digest('hex');
					if ( ! ( typeof sessions[hash] == 'undefined' || sessions[hash] == null ) ) {
						hash = null;	
					}
				}
				sessions[hash] = {
					status: hash,
					lines: '',
					type: 'ps',
					result: ''
				};
				return doDone(hash);
			};
			if ( params.instruction == 'lazyStatus' ) {
				var hash = params.id;
				if ( !hash ) { return doDone('no task ID specified', true); };
				if ( typeof sessions[hash] == 'undefined' || sessions[hash] == null) { return doDone('no session '+hash, true); }
				var session = sessions[hash];
				if ( session.status == 'error' ) { return doDone( session.result, true ); }
				if ( session.status == 'success' ) { return doDone( session.result ); }
				return doDone(session.status);
			};
			if ( params.instruction == 'lazyRun' ) {
				var hash = params.id;
				if ( !hash ) { return doDone('no task ID specified', true); };
				if ( typeof sessions[hash] == 'undefined' || sessions[hash] == null) { return doDone('no session '+hash, true); }
				var session = sessions[hash];
				doDone(session.status);
				ScriptExecuter(session.type, session.lines, [])
					.run(function(code, msg){
						session.result = msg;
						session.status = 'success';
						console.log(msg);
					}, function(code, msg){
						session.result = msg;
						session.status = 'error';
						console.log(msg);
					});
				return;
			};
		} catch (e) {
			return doDone(e.toString(), true)
		}
		return doDone('Invalid instruction', true);
	};
	//console.log(params, typeof params.lazy);
	if ( params.lazy != 'false' ) {
		var hash = params.lazy;
		if ( !hash ) { return doDone('no task ID specified', true); };
		if ( typeof sessions[hash] == 'undefined' || sessions[hash] == null) { return doDone('no session '+hash, true); }
		var session = sessions[hash];
		if ( session.type != params.type ) { return doDone('unsupported script type "'+params.type+'"for lazy running', true); }
		session.lines += params.data + '\n';
		return doDone(session.status);
	};
	ScriptExecuter(params.type, params.data, [params.path])
		.run(function(code, msg){
           		console.log(params.type+' out: '+msg);
				if ( params.json ) { msg = wrap_jsonp(msg, params.success); }
				res.end(msg);
        	}, function(code, msg){
           		console.log(params.type+' err ('+code+'): '+msg);
				if ( params.json ) { msg = wrap_jsonp(msg, params.error); }
				res.end(msg);
        	});
}).listen(8080, "0.0.0.0");
console.log('Server running at http://0.0.0.0:8080/');



