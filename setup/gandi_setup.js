(async function(){
  https = require('https')
  fs = require('fs')
  const prompts = require('prompts');

  const NodeRSA = require('node-rsa');
  const key = new NodeRSA({b: 1024});

  //start off by getting dkim pair or generating a new dkim keypair
  try{
    private_key = fs.readFileSync('dkim_private.pem').toString('utf8')
    public_key = fs.readFileSync('dkim_public.pem').toString('utf8')
    public_key_oneliner = public_key.replace(/^-.*-$/mg,'').replace(/[\r\n]+/g, '')
    console.log('Using existing keypair...')
  }catch(err){
    console.log('no key pair found...')
    console.log("Generating New Keypair For DKIM:")
    private_key = key.exportKey('pkcs8-private')
    public_key = key.exportKey('public')
    public_key_oneliner = public_key.replace(/^-.*-$/mg,'').replace(/[\r\n]+/g, '')
    fs.writeFileSync('dkim_private.pem', private_key)
    fs.writeFileSync('dkim_public.pem', public_key)
    console.log(private_key)
    console.log(public_key) 
  }
   
  var domain = await prompts({
      type: 'text',
      name: 'value',
      message: 'Enter your Gandi Domain:'
  });
  
  var api_key = await prompts({
      type: 'password',
      name: 'value',
      message: 'Enter your Gandi API Key:'
  });

  var server_ip = await prompts({
      type: 'text',
      name: 'value',
      message: 'Enter your Server IP (Defaults to This Boxe\'s IP):'
  });

  if(server_ip.value == ""){
    server_ip.value = await getIP()
  }
  setupDNS(domain.value, server_ip.value, api_key.value)

  function setupDNS(domain, server_ip, api_key){
    var server = server_ip.replace(/\n/, '')
    // Set the headers for the request
    var headers = {
      'X-Api-Key': api_key
    };
  
    // Configure the request
    var options = {
      hostname: 'dns.api.gandi.net',
      //path: '/api/v5/zones',
      path: '/api/v5/domains/' + domain + '/records',
      method: 'GET',
      headers: headers
    };
  
    https.get(options,  (resp) => {
      let data = '';
  
      resp.on('data', (chunk) => {
        data += chunk;
      });
  
      resp.on('end', () => {
        //console.log("printing " + domain + " records")
        //console.log(JSON.parse(data))
        server_ip = process.argv[3]
      
        //define the records we want to set up
        required_records = {
          "@:A": '{"rrset_ttl":600,"rrset_values":["' + server + '"]}',
          "*:A": '{"rrset_ttl":600,"rrset_values":["' + server + '"]}',
          "mx:A": '{"rrset_ttl":600,"rrset_values":["' + server + '"]}',
          "@:MX": '{"rrset_ttl":600,"rrset_values":["10 mx.' + domain + '."]}',
          "@:TXT": '{"rrset_ttl":600,"rrset_values":["v=spf1 mx a ptr ip4:38.126.169.96/28 ip4:' + server + '/32 include:gandi.net include:sendgrid.net -all"]}',
          "_dmarc:TXT": '{"rrset_ttl":600,"rrset_values":["v=DMARC1; p=none"]}',
          "default._domainkey:TXT": '{"rrset_ttl":600,"rrset_values":["v=DKIM1; k=rsa; p=' + public_key_oneliner + '"]}'
        }
  
        //modify any existing records
        JSON.parse(data).forEach(function (record, index) {
          record_key = record.rrset_name + '.' + record.rrset_type 
          if(typeof required_records[record_key] !== 'undefined'){
            console.log("Found Record: ");
            console.log(record);
            console.log("\n");
            console.log("Changing to: ");
            console.log(required_records[record_key])
            console.log("\n");
            record_string = required_records[record_key]
            href = record.rrset_href
            href = '/' + href.split('/').slice(3).join('/')
            updateRecord(href, record_string, api_key)
            delete required_records[record_key]
          }else{
            console.log("Deleting Stock Record: ");
            console.log(record)
            console.log("\n");
            href = record.rrset_href
            href = '/' + href.split('/').slice(3).join('/')
            deleteRecord(href, api_key)
          }
        });
        //add any additional needed records
        Object.keys(required_records).forEach(function (key) {
          new_record = JSON.parse(required_records[key])
          record_entry = key.split(':')
          new_record.rrset_name = record_entry[0]
          new_record.rrset_type = record_entry[1]
          console.log("Creating New Record: ");
          console.log(new_record);
          console.log("\n");
          createRecord(domain, JSON.stringify(new_record), api_key)
        });
  
      });
  
    }).on("error", (err) => {
      console.log("Error: " + err.message);
    });
  }
  
  function updateRecord(href, record, api_key){
    var headers = {
        'Content-Type': 'application/json',
        //'Accept-Encoding': 'application/json',
        //'Content-Length': Buffer.byteLength(post_data),
        //'Cookie': cookie
        'X-Api-Key': api_key,
        'Content-Length': Buffer.byteLength(record)
    };
    // Configure the request
    var options = {
        hostname: 'dns.api.gandi.net',
        //path: '/api/v5/zones',
        path: href,
        method: 'PUT',
        headers: headers
    };
  
    var post_request =  https.request(options,  (resp) => {
      let data = '';
  
      resp.on('data', (chunk) => {
        data += chunk;
      });
  
      resp.on('end', () => {
        console.log(data)
      });
  
    }).on("error", (err) => {
       console.log("Error: " + err.message);
    });
  
    post_request.write(record)
    post_request.end()
  
  }
  
  function createRecord(domain, record, api_key){
    var headers = {
        'Content-Type': 'application/json',
        'X-Api-Key': api_key,
        'Content-Length': Buffer.byteLength(record)
    };
    // Configure the request
    var options = {
        hostname: 'dns.api.gandi.net',
        path: '/api/v5/domains/'+ domain +'/records',
        method: 'POST',
        headers: headers
    };
  
    var post_request =  https.request(options,  (resp) => {
      let data = '';
  
      resp.on('data', (chunk) => {
        data += chunk;
      });
  
      resp.on('end', () => {
        console.log(data)
      });
  
    }).on("error", (err) => {
       console.log("Error: " + err.message);
    });
  
    post_request.write(record)
    post_request.end()
  
  }
  
  function deleteRecord(href, api_key){
    var headers = {
        'Content-Type': 'application/json',
        'X-Api-Key': api_key
    };
    // Configure the request
    var options = {
        hostname: 'dns.api.gandi.net',
        //path: '/api/v5/zones',
        path: href,
        method: 'DELETE',
        headers: headers
    };
    delete_request = https.request(options,  (resp) => {
      let data = '';
  
      resp.on('data', (chunk) => {
        data += chunk;
      });
  
      resp.on('end', () => {
        console.log(data)
      });
  
    }).on("error", (err) => {
       console.log("Error: " + err.message);
    });
  
    delete_request.end()
  }

  async function getIP(){
    return new Promise(function(resolve, reject){
      var headers = {
        'Content-Type': 'text/plain'
      };
      // Configure the request
      var options = {
        hostname: 'ifconfig.io',
        path: '/ip',
        method: 'GET',
        headers: headers
      };
      var request = https.request(options,  (resp) => {
        let data = '';
  
        resp.on('data', (chunk) => {
          data += chunk;
        });
  
        resp.on('end', () => {
          console.log("Using Current IP:" + data)
          resolve(data)
        });
  
      }).on("error", (err) => {
        console.log("Error: " + err.message);
        reject(err.message)
      });
      request.end();
    });
  }
})() 
