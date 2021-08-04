var fs = require("fs")
var stream = require("stream")
const nodemailer = require("nodemailer")
const SMTPServer = require("smtp-server").SMTPServer
const dateFormat = require("dateformat")
const bunyan = require("bunyan");
const fastify = require('fastify')({
  logger: true,
  bodyLimit: 19922944
})
const got = require('got')
fastify.register(require('fastify-cookie'))
fastify.register(require('fastify-socket.io'), {})
const EventEmitter = require('events')
class GlobalEmitter extends EventEmitter {}
const globalEmitter = new GlobalEmitter()

async function sendMail(mail_object, io) {
  return new Promise(function(resolve, reject) {
    //add our own custom stream to send back to the client over websockets for debugging
    var ioStream = new stream.Writable()
    ioStream._write = function(chunk, encoding, done) {
      try {
        output = JSON.parse(chunk.toString()).msg;
        //try to avoid mail content in the log feed. SMTP command output usually is not multi-lined
        if (output.match(/\n/) == null) {
          io.emit("smtp_command", {
            campaign: mail_object.campaign,
            data: output
          })
        }
      } catch (err) {
        io.emit("smtp_command", {
          campaign: mail_object.campaign,
          data: chunk.toString()
        })
      }
      done()
    }

    let logger = bunyan.createLogger({
      name: "nodemailer"
    })

    logger.level("debug");

    logger.addStream({
      name: "ioStream",
      stream: ioStream,
      level: "debug"
    })

    transport_settings = {
      host: mail_object.supplied_mail_server,
      name: mail_object.supplied_smtp_from.split("@")[1],
      port: 25,
      secure: false,
      tls: {rejectUnauthorized: false},
      logger,
      debug: true
    }

    //Check to use supplied creds without the use of secure mail for sending through a relay
    if (mail_object.supplied_username !== '' && mail_object.secure_mail == false){
      transport_settings.auth = {
        user: mail_object.supplied_username,
        pass: mail_object.supplied_password
      }
    }

    if (mail_object.dkim == true) {
      transport_settings.dkim = {
        domainName: mail_object.supplied_smtp_from.split("@")[1],
        keySelector: "default",
        privateKey: fs.readFileSync("./setup/dkim_private.pem", "utf8")
      }
    }

    if (mail_object.secure_mail) {
      transport_settings.port = 465
      transport_settings.secure = true
      transport_settings.auth = {
        user: mail_object.supplied_username,
        pass: mail_object.supplied_password
      }
    }
    transport = new nodemailer.createTransport(transport_settings)

    console.log(logger);

    //make the necessary substitutions before sending
    var now = new Date().toLocaleString("en-US", {timeZone: config.timezone})
    timestamp = dateFormat(now, "ddd, dd mmm yyyy HH:MM:ss o");
    let concat = mail_object.supplied_link.includes('?')?'&':'?'
    let phishing_link =
      mail_object.supplied_link +
      concat +
      mail_object.supplied_id_param +
      "=" +
      mail_object.target_id
    let local_copy = mail_object.mail_data
    local_copy = local_copy.replace(/DateTimeStamp/, timestamp)
    local_copy = local_copy.replace(
      /SuppliedToAddress/gm,
      mail_object.supplied_mail_to
    );
    local_copy = local_copy.replace(/SuppliedPhishingLink/gm, phishing_link)
    local_copy = local_copy.replace(
      /SuppliedFirstName/gm,
      mail_object.supplied_first_name
    );
    local_copy = local_copy.replace(
      /SuppliedLastName/gm,
      mail_object.supplied_last_name
    );
    local_copy = local_copy.replace(
      /SuppliedPosition/gm,
      mail_object.supplied_position
    );
    local_copy = local_copy.replace(
      /SuppliedCustomReplacement/gm,
      mail_object.supplied_custom_replacement
    );

    let attachment = ""
    for (i = 0; i < phishing_link.length; i++) {
      hex = phishing_link.charCodeAt(i).toString(16)
      attachment += "\\x" + ("0" + hex).slice(-2)
    }

    //make the message content one single raw attachment like https://nodemailer.com/message/custom-source/
    let message = {
      envelope: {
        from: mail_object.supplied_smtp_from,
        to: [mail_object.supplied_mail_to]
      },
      raw: local_copy
    }

    transport.sendMail(message, function(err, info) {
      if (err) {
        console.log(err);
        //just try to keep going anyway
        createEvent(
          {
            //450 & 451 is greylist or rate limit
            campaign: mail_object.campaign,
            event_ip: "localhost",
            target: mail_object.target_id,
            event_type: "ERROR",
            event_data: err.toString()
          },
          io
        )
        try {
          got(
            `https://api.telegram.org/` +
            `${config.signal_bot.bot_id}` +
            `/sendMessage?chat_id=` +
            `${config.signal_bot.chat_id}` +
            `&text=%22` +
            `${mail_object.campaign}` +
            `:ERROR:` +
            `${err}` +
            `%22`
          );
        } catch (err) {
          console.log("Error sending Signal Message: " + err)
        }
        resolve(err);
        //reject(err)
      } else {
        console.log(info);
        var stmt = db.prepare(
          `UPDATE targets 
            SET (phished) = 1 
            WHERE target_id = $target_id`
        );
        stmt.run({
          "target_id": mail_object.target_id
        })
        resolve(info)
      }
    })
  })
}

async function sendCampaign(campaign, io){
  let target_query = db.prepare(`
    SELECT * FROM targets WHERE campaign=$campaign
    AND phished=0
  `)
  let target = target_query.get({campaign: campaign.name})
  console.log(target)
  if(target == undefined){
    console.log(`stopping campaign: ${campaign.name} - No more targets`)
    let set_end = db.prepare(`
      UPDATE campaigns SET (end_timestamp, is_sending) = ($end_time, 0) WHERE name = $campaign
    `)
    let end_time = new Date().getTime()
    set_end.run({end_time: end_time, campaign: campaign.name})
    globalEmitter.emit(`stopCampaign-${campaign.name}`)
    return
  }else{
    email = {}
    email.target_id = target.target_id
    email.supplied_mail_to = target.address
    email.supplied_first_name = target.first_name
    email.supplied_last_name = target.last_name
    email.supplied_position = target.position
    email.supplied_custom_replacement = target.custom
    email.campaign = campaign.name
    email.mail_data = campaign.email
    email.supplied_link = campaign.phishing_link
    email.supplied_id_param = campaign.id_parameter
    email.supplied_smtp_from = campaign.smtp_from
    email.supplied_mail_server = campaign.mail_server
    email.supplied_username = campaign.username
    email.supplied_password = campaign.password
    if (campaign.secure == 1) {
      email.secure_mail = true
    } else {
      email.secure_mail = false
    }
    if (campaign.dkim == 1) {
      email.dkim = true
    } else {
      email.dkim = false
    }
    sendMail(email, io)
    createEvent(
      {
        campaign: target.campaign,
        event_ip: "localhost",
        target: String(target.target_id),
        event_type: "EMAIL_SENT",
        event_data: target.address
      },
      io
    )
  }
}

async function captureMail(io) {
    return new Promise(function(resolve, reject) {
      server = new SMTPServer({
        disabledCommands: ["STARTTLS", "AUTH"],
        logger: true,
        //socketTimeout: 3000,
        secure: false //,
        //key: fs.readFileSync("private.key"),
        //cert: fs.readFileSync("server.crt")
      })
      //server.listen(465);
      server.onData = function(stream, session, callback) {
        stream.pipe(process.stdout); // print message to console
        stream.on("data", function(data) {
          io.emit("email_content", data)
        })
        stream.on("end", () => {
          io.emit("capture_complete", {})
          callback(null, "Message queued as pwnage")
          stream.destroy()
          server.close()
          resolve;
        })
      }
  
      server.onConnect = function(session, callback) {
        console.log(session)
        return callback()
      }
  
      server.listen(25)
    })
  }

// Import Swagger Options
const swagger = require('./config/swagger')

// Register Swagger
//fastify.register(require('fastify-swagger'), swagger.options)
//New Open API Standard
fastify.register(require('fastify-oas'), swagger.options)

config = JSON.parse(fs.readFileSync("./config.json"));
set_admin = config.set_admin.switch;

//database setup
const Database = require('better-sqlite3')
const { resolve } = require("path")
const db = new Database('./db/aquarium.db', { verbose: console.log })
let template_setup = db.prepare(`
    CREATE TABLE IF NOT EXISTS templates (
        name TEXT PRIMARY KEY,
        email TEXT
    )
`)
template_setup.run()

let campaign_setup = db.prepare(`
    CREATE TABLE IF NOT EXISTS campaigns (
        name TEXT,
        email TEXT,
        mail_server TEXT,
        smtp_from TEXT,
        phishing_link TEXT,
        id_parameter TEXT,
        delay INTEGER,
        secure INTEGER,
        username TEXT,
        password TEXT,
        dkim INTEGER,
        scheduled_start INTEGER,
        start_timestamp INTEGER,
        end_timestamp INTEGER,
        is_sending INTEGER,
        market_id INTEGER
    )
`)
campaign_setup.run()

let target_setup = db.prepare(`
    CREATE TABLE IF NOT EXISTS targets (
        target_id TEXT,
        address TEXT,
        campaign TEXT,
        first_name TEXT,
        last_name TEXT,
        position TEXT,
        custom TEXT,
        phished INTEGER
    )
`)
target_setup.run()

let event_setup = db.prepare(`
    CREATE TABLE IF NOT EXISTS events (
        event_timestamp INTEGER,
        event_ip TEXT,
        campaign TEXT,
        target TEXT,
        event_type TEXT,
        event_data TEXT,
        ignore INTEGER
    )
`)
event_setup.run()

async function createEvent(new_event, io) {
  console.log(new_event)
  new_event.event_timestamp = new Date().getTime()
  var event = db.prepare(`
    INSERT INTO events VALUES (
      $timestamp,
      $ip,
      $campaign,
      $target,
      $type,
      $data,
      $ignore
    )`
  )
  event.run(
    {
      "timestamp": new_event.event_timestamp,
      "ip": new_event.event_ip,
      "campaign": new_event.campaign,
      "target": new_event.target,
      "type": new_event.event_type,
      "data": new_event.event_data,
      "ignore": 0
    }
  )
  io.emit("new_event", new_event)
}
//make sure we are authorized
fastify.addHook('preHandler', (req, reply, done) => {
    if(req.url.includes('documentation')){
      done()
    }else if((req.url.includes(config.set_admin.search_string) && set_admin)){
        reply.header(
            "set-cookie",
            config.admin_cookie.cookie_name +
              "=" +
              config.admin_cookie.cookie_value +
              ";secure;httponly;max-age=31536000"
          );
          reply.redirect('/admin')
          set_admin = false;
          config.set_admin.switch = false;
          fs.writeFileSync("./config.json", JSON.stringify(config, null, 4));
    }else{
      const admin_cookie = req.cookies['admin_cookie']
      if(admin_cookie == config.admin_cookie.cookie_value){
        done()
      }else{
        reply.code(401).send('Not Authorized')
        done()
      }
    }
  })

//favicon
fastify.route({
    method: ['GET'],
    url: '/favicon.ico',
    handler: async function (req, reply) {
        let stream = fs.createReadStream(__dirname + "/resources/misc/favicon.ico")
        reply.type('image/x-icon').send(stream)
    }
}) 

//basic homepage. You can mod it to look like a normal server of your choosing
fastify.route({
    method: ['GET'],
    url: '/',
    handler: async function (req, reply) {
        let stream = fs.createReadStream(__dirname + "/resources/pages/homepage.html")
        reply.type('text/html').send(stream)
    }
})  

//static .js files
fastify.route({
    method: ['GET'],
    url: '/static/js/*',
    handler: async function (req, reply) {
        let stream = fs.createReadStream(__dirname + "/resources/js/" + req.params['*'])
        reply.type('text/javascript').send(stream)
    }
}) 

//static .css files
fastify.route({
    method: ['GET'],
    url: '/static/css/*',
    handler: async function (req, reply) {
        let stream = fs.createReadStream(__dirname + "/resources/styles/" + req.params['*'])
        reply.type('text/css').send(stream)
    }
}) 

//static admin homepage
fastify.route({
    method: ['GET'],
    url: '/admin',
    handler: async function (req, reply) {
        let stream = fs.createReadStream(__dirname + "/resources/pages/admin.html")
        reply.type('text/html').send(stream)
    }
}) 

//static create campaign html
fastify.route({
    method: ['GET'],
    url: '/create_campaign',
    handler: async function (req, reply) {
        let stream = fs.createReadStream(__dirname + "/resources/pages/create_campaign.html")
        reply.type('text/html').send(stream)
    }
}) 

//static edit campaign html
fastify.route({
  method: ['GET'],
  url: '/edit_campaign',
  handler: async function (req, reply) {
      let stream = fs.createReadStream(__dirname + "/resources/pages/edit_campaign.html")
      reply.type('text/html').send(stream)
  }
})

//static view campaign html
fastify.route({
  method: ['GET'],
  url: '/track_campaign',
  handler: async function (req, reply) {
      let stream = fs.createReadStream(__dirname + "/resources/pages/track_campaign.html")
      reply.type('text/html').send(stream)
  }
}) 

//static view targets for a campaign html
fastify.route({
  method: ['GET'],
  url: '/edit_targets',
  handler: async function (req, reply) {
      let stream = fs.createReadStream(__dirname + "/resources/pages/edit_targets.html")
      reply.type('text/html').send(stream)
  }
}) 

//static view target html
fastify.route({
  method: ['GET'],
  url: '/view_target',
  handler: async function (req, reply) {
      let stream = fs.createReadStream(__dirname + "/resources/pages/view_target.html")
      reply.type('text/html').send(stream)
  }
})

//static search events html
fastify.route({
  method: ['GET'],
  url: '/search_events',
  handler: async function (req, reply) {
      let stream = fs.createReadStream(__dirname + "/resources/pages/search_events.html")
      reply.type('text/html').send(stream)
  }
})

fastify.route({
    method: ['GET'],
    url: '/list_templates',
    schema: {
        security: [{cookieAuth: []}],
        description: 'Get a list of local templates',
        tags: ['Template'],
        summary: 'get a list of template names',
        response: {
          200: {
            description: 'Successful response',
            type: 'array'
          }
        }
    },
    handler: async function (req, reply) {
        let templates = db.prepare(`SELECT name FROM templates`).pluck()
        reply.type('application/json').send(templates.all())
    }
})

fastify.route({
  method: ['GET'],
  url: '/get_template',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Get a full local template',
      tags: ['Template'],
      summary: 'get a local template by name',
      querystring: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'template name',
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'object',
          properties: {
            name: {
              type: 'string'
            },
            email: {
              type: 'string'
            }
          }
        }
      }
  },
  handler: async function (req, reply) {
      let template_query = db.prepare(`
        SELECT * FROM templates
        WHERE name = $name
      `)
      let template_name = req.query['name']
      let template = template_query.get({"name": template_name})
      console.log(template)
      reply.type('application/json').send(template)
  }
})

fastify.route({
    method: ['GET'],
    url: '/list_campaigns',
    schema: {
        security: [{cookieAuth: []}],
        description: 'Get a list of campaigns',
        tags: ['Campaign'],
        summary: 'get a list of campaigns',
        response: {
          200: {
            description: 'Successful response',
            type: 'array'
          }
        }
    },
    handler: async function (req, reply) {
        let campaigns = db.prepare(`
            SELECT 
                name,
                mail_server,
                smtp_from,
                phishing_link,
                id_parameter,
                delay,
                scheduled_start,
                start_timestamp,
                end_timestamp,
                market_id,
                is_sending
            FROM campaigns
        `)
        reply.type('application/json').send(campaigns.all())
    }
})

fastify.route({
  method: ['POST'],
  url: '/send_test_email',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Test a template or campaign email',
    tags: ['Template','Campaign'],
    summary: 'test a phishing email',
    body: {
      type: 'object',
      properties: {
        campaign: {
          type: 'string',
          default: 'test',
          description: 'campaign name'
        },
        dkim: {
          type: 'boolean',
          default: false,
          description: 'should we DKIM sign the message'
        },
        mail_data: {
          type: 'string',
          description: 'raw email message'
        },
        target_id: {
          type: 'string',
          default: 'test',
          description: 'unique ID of the target user'
        },
        secure_mail: {
          type: 'boolean',
          default: false,
          description: 'Should we use TLS for this message'
        },
        supplied_custom_replacement: {
          type: 'string',
          description: 'custom placeholder for per-target replacements'
        },
        supplied_delay: {
          type: 'string',
          default: "30",
          description: 'delay between emails'
        },
        supplied_first_name: {
          type: 'string',
          description: 'substitution placeholder for target first names'
        },
        supplied_from_address:{
          type: 'string',
          description: 'email FROM address'
        },
        supplied_from_title:{
          type: 'string',
          description: 'email alias name'
        },
        supplied_id_param:{
          type: 'string',
          description: 'tracking ID GET param name for the target'
        },
        supplied_last_name: {
          type: 'string',
          description: 'substitution placeholdder for the target first name'
        },
        supplied_link: {
          type: 'string',
          description: 'base link URL for the phishing link'
        },
        supplied_mail_server: {
          type: 'string',
          description: 'mail server to send the test to'
        },
        supplied_mail_to:{
          type: 'string',
          description: 'target email address'
        },
        supplied_password:{
          type: 'string',
          description: 'password for authenticated SMTP relay'
        },
        supplied_position:{
          type: 'string',
          description: 'substitution placeholder for the target position'
        },
        supplied_smtp_from: {
          type: 'string',
          description: 'SMTP mail from: field'
        },
        supplied_username: {
          type: 'string',
          description: 'username for authenticated SMTP relay'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":sending test email: \n")
    let email = req.body
    sendMail(email, fastify.io)
    reply.code(200).send('email sent')
  }
})

fastify.route({
  method: ['POST'],
  url: '/save_template',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Save a local template',
    tags: ['Template'],
    summary: 'save local template',
    body: {
      type: 'object',
      properties: {
        template_name: {
          type: 'string',
          description: 'template name'
        },
        mail_data: {
          type: 'string',
          description: 'template MIME content'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":saved email template: \n")
    let template = req.body
    let new_template = db.prepare(`
      INSERT INTO templates (name, email) VALUES ($template_name, $mail_data)
      ON CONFLICT(name) DO UPDATE SET email=$mail_data
    `)
    new_template.run({template_name: template.template_name, mail_data: template.mail_data})
    reply.code(200).send('Template Saved')
  }
})

fastify.route({
  method: ['DELETE'],
  url: '/delete_template',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Delete a local template',
    tags: ['Template'],
    summary: 'delete local template',
    body: {
      type: 'object',
      properties: {
        template_name: {
          type: 'string',
          description: 'template name'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":deleted email template: \n")
    let template = req.body
    let new_template = db.prepare(`
      DELETE FROM templates WHERE name = $template
    `)
    new_template.run({template: template.template_name})
    reply.code(200).send('Template Deleted')
  }
})

fastify.route({
  method: ['POST'],
  url: '/save_campaign',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Save email as a campaign',
    tags: ['Campaign'],
    summary: 'save campaign',
    body: {
      type: 'object',
      properties: {
        campaign: {
          type: 'string',
          default: 'test',
          description: 'campaign name'
        },
        market_id:{
          type: 'number',
          default: 0,
          description: 'ID of Phismarket template, if one was used'
        },
        dkim: {
          type: 'boolean',
          default: false,
          description: 'should we DKIM sign the message'
        },
        mail_data: {
          type: 'string',
          description: 'raw email message'
        },
        target_id: {
          type: 'string',
          default: 'test',
          description: 'unique ID of the target user'
        },
        secure_mail: {
          type: 'boolean',
          default: false,
          description: 'Should we use TLS for this message'
        },
        supplied_custom_replacement: {
          type: 'string',
          description: 'custom placeholder for per-target replacements'
        },
        supplied_delay: {
          type: 'string',
          default: "30",
          description: 'delay between emails'
        },
        supplied_first_name: {
          type: 'string',
          description: 'substitution placeholder for target first names'
        },
        supplied_from_address:{
          type: 'string',
          description: 'email FROM address'
        },
        supplied_from_title:{
          type: 'string',
          description: 'email alias name'
        },
        supplied_id_param:{
          type: 'string',
          description: 'tracking ID GET param name for the target'
        },
        supplied_last_name: {
          type: 'string',
          description: 'substitution placeholdder for the target first name'
        },
        supplied_link: {
          type: 'string',
          description: 'base link URL for the phishing link'
        },
        supplied_mail_server: {
          type: 'string',
          description: 'mail server to send the test to'
        },
        supplied_mail_to:{
          type: 'string',
          description: 'target email address'
        },
        supplied_password:{
          type: 'string',
          description: 'password for authenticated SMTP relay'
        },
        supplied_position:{
          type: 'string',
          description: 'substitution placeholder for the target position'
        },
        supplied_smtp_from: {
          type: 'string',
          description: 'SMTP mail from: field'
        },
        supplied_username: {
          type: 'string',
          description: 'username for authenticated SMTP relay'
        },
        market_id:{
          type: 'number',
          description: 'the ID of the phishmarket template if this was created from a remote template'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":saved campaign: \n")
    let campaign = req.body
    var dkim = 0
    if (campaign.dkim) {
      dkim = 1
    }
    var secure = 0
    if (campaign.secure_mail) {
      secure = 1
    }
    var delay = 30
    if (
      (typeof campaign.supplied_delay !== "undefined") &
      (campaign.supplied_delay !== "")
    ) {
      delay = parseInt(campaign.supplied_delay)
    }
    var new_campaign = db.prepare(
      `INSERT INTO campaigns VALUES (
        $name, 
        $email,
        $mail_server,
        $smtp_from,
        $phishing_link,
        $id_parameter,
        $delay,
        $secure,
        $username,
        $password,
        $dkim,
        $scheduled_start,
        $start_timestamp,
        $end_timestamp,
        $is_sending,
        $market_id
      )`
    )
    new_campaign.run({
      name: String(campaign.campaign_name),
      email: campaign.mail_data,
      mail_server: campaign.supplied_mail_server,
      smtp_from: campaign.supplied_smtp_from,
      phishing_link: campaign.supplied_link,
      id_parameter: campaign.supplied_id_param,
      delay: delay,
      secure: secure,
      username: campaign.supplied_username,
      password: campaign.supplied_password,
      dkim: dkim,
      scheduled_start: null,
      start_timestamp: null,
      end_timestamp: null,
      is_sending: 0,
      market_id: campaign.market_id
    })
    reply.code(200).send('Saved Campaign')
  }
})

fastify.route({
  method: ['PUT'],
  url: '/update_campaign',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Update a campaign',
    tags: ['Campaign'],
    summary: 'update campaign',
    body: {
      type: 'object',
      properties: {
        campaign: {
          type: 'string',
          default: 'test',
          description: 'campaign name'
        },
        dkim: {
          type: 'boolean',
          default: false,
          description: 'should we DKIM sign the message'
        },
        mail_data: {
          type: 'string',
          description: 'raw email message'
        },
        target_id: {
          type: 'string',
          default: 'test',
          description: 'unique ID of the target user'
        },
        secure_mail: {
          type: 'boolean',
          default: false,
          description: 'Should we use TLS for this message'
        },
        supplied_custom_replacement: {
          type: 'string',
          description: 'custom placeholder for per-target replacements'
        },
        supplied_delay: {
          type: 'string',
          default: "30",
          description: 'delay between emails'
        },
        supplied_first_name: {
          type: 'string',
          description: 'substitution placeholder for target first names'
        },
        supplied_from_address:{
          type: 'string',
          description: 'email FROM address'
        },
        supplied_from_title:{
          type: 'string',
          description: 'email alias name'
        },
        supplied_id_param:{
          type: 'string',
          description: 'tracking ID GET param name for the target'
        },
        supplied_last_name: {
          type: 'string',
          description: 'substitution placeholdder for the target first name'
        },
        supplied_link: {
          type: 'string',
          description: 'base link URL for the phishing link'
        },
        supplied_mail_server: {
          type: 'string',
          description: 'mail server to send the test to'
        },
        supplied_mail_to:{
          type: 'string',
          description: 'target email address'
        },
        supplied_password:{
          type: 'string',
          description: 'password for authenticated SMTP relay'
        },
        supplied_position:{
          type: 'string',
          description: 'substitution placeholder for the target position'
        },
        supplied_smtp_from: {
          type: 'string',
          description: 'SMTP mail from: field'
        },
        supplied_username: {
          type: 'string',
          description: 'username for authenticated SMTP relay'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":updated campaign: \n")
    let campaign = req.body
    var dkim = 0
    if (campaign.dkim) {
      dkim = 1
    }
    var secure = 0
    if (campaign.secure_mail) {
      secure = 1
    }
    var delay = 30
    if (
      (typeof campaign.supplied_delay !== "undefined") &
      (campaign.supplied_delay !== "")
    ) {
      delay = parseInt(campaign.supplied_delay)
    }
    var edit_campaign = db.prepare(
      `UPDATE campaigns SET(
        email,
        mail_server,
        smtp_from,
        phishing_link,
        id_parameter,
        delay,
        secure,
        username,
        password,
        dkim
      ) = (
        $email,
        $mail_server,
        $smtp_from,
        $phishing_link,
        $id_parameter,
        $delay,
        $secure,
        $username,
        $password,
        $dkim
      )
      WHERE name = $name`
    )
    edit_campaign.run({
      name: String(campaign.campaign_name),
      email: campaign.mail_data,
      mail_server: campaign.supplied_mail_server,
      smtp_from: campaign.supplied_smtp_from,
      phishing_link: campaign.supplied_link,
      id_parameter: campaign.supplied_id_param,
      delay: delay,
      secure: secure,
      username: campaign.supplied_username,
      password: campaign.supplied_password,
      dkim: dkim
    })
    reply.code(200).send('Updated Campaign')
  }
})

fastify.route({
  method: ['GET'],
  url: '/get_campaign',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Get a campaign object',
      tags: ['Campaign'],
      summary: 'get campaign settings',
      querystring: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'campaign name',
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'campaign name'
            },
            dkim: {
              type: 'number',
              description: 'should we DKIM sign the message'
            },
            email: {
              type: 'string',
              description: 'raw email message'
            },
            secure: {
              type: 'number',
              description: 'Should we use TLS for this message'
            },
            delay: {
              type: 'string',
              default: "30",
              description: 'delay between emails'
            },
            id_param:{
              type: 'string',
              description: 'tracking ID GET param name for the target'
            },
            phishing_link: {
              type: 'string',
              description: 'base link URL for the phishing link'
            },
            mail_server: {
              type: 'string',
              description: 'mail server to send the test to'
            },
            password:{
              type: 'string',
              description: 'password for authenticated SMTP relay'
            },
            smtp_from: {
              type: 'string',
              description: 'SMTP mail from: field'
            },
            username: {
              type: 'string',
              description: 'username for authenticated SMTP relay'
            }
          }
        }
      }
  },
  handler: async function (req, reply) {
      let campaign_query = db.prepare(`
        SELECT * FROM campaigns WHERE name = $name
      `)
      let campaign = campaign_query.get({name: req.query["name"]})
      reply.type('application/json').send(JSON.stringify(campaign))
  }
})

fastify.route({
  method: ['POST'],
  url: '/create_event',
  schema: {
      security: [{cookieAuth: []}],
      description: 'create a tracked event',
      tags: ['Event'],
      summary: 'create event',
      body: {
        type: 'object',
        properties: {
          event_ip: {
            type: 'string',
            description: 'where the event came frome'
          },
          target:{
            type: 'string',
            description: 'the unique target ID of the user'
          },
          event_type: {
            type: 'string',
            description: 'the type of event (i.e. CLICK, POST_DATA, DIRECT_DOWNLOAD, COOKIE_DATA)'
          },
          event_data: {
            type: 'string',
            description: 'the relevant data for the event'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'string'
        }
      }
  },
  handler: async function (req, reply) {
    let event_object = req.body
    let get_campaign = db.prepare(`
      SELECT campaign FROM targets WHERE target_id = $target
    `).pluck()
    let campaign = get_campaign.get({"target": event_object.target})
    console.log(campaign)
    createEvent(
      {    
        campaign: String(campaign),
        event_ip: String(event_object.event_ip),
        target: String(event_object.target),
        event_type: String(event_object.event_type),
        event_data: String(event_object.event_data)
      },   
      fastify.io
    )
    reply.send('Event created')
  }
})

fastify.route({
  method: ['GET'],
  url: '/get_campaign_events',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Get all events for a campaign',
      tags: ['Event'],
      summary: 'get campaign events',
      querystring: {
        type: 'object',
        properties: {
          campaign: {
            type: 'string',
            description: 'campaign name'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'array'
        }
      }
  },
  handler: async function (req, reply) {
      let events_query = db.prepare(`
        SELECT * FROM events WHERE ignore=0 AND campaign = $campaign
      `)
      let events = events_query.all({"campaign": req.query["campaign"]})
      reply.type('application/json').send(JSON.stringify(events))
  }
})

fastify.route({
  method: ['PUT'],
  url: '/send_campaign',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Send the campaign',
      tags: ['Campaign'],
      summary: 'start sending the campaign',
      body: {
        type: 'object',
        properties: {
          campaign: {
            type: 'string',
            description: 'campaign name'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'string'
        }
      }
  },
  handler: async function (req, reply) {
      let campaign_query = db.prepare(`
        SELECT * FROM campaigns WHERE name = $campaign
      `)
      let campaign = campaign_query.get({"campaign": req.body["campaign"]})
      if(campaign.is_sending == 1){
        reply.send('WARNING: you are already sending this campaign')
      }else{
        let set_start = db.prepare(`
          UPDATE campaigns SET (start_timestamp, is_sending) = ($start_time, 1) WHERE name = $campaign
        `)
        let start_time = new Date().getTime()
        set_start.run({start_time: start_time, campaign: campaign.name})
        sendCampaign(campaign, fastify.io)
        let timerId = setInterval(function(){sendCampaign(campaign, fastify.io)}, campaign.delay * 1000)
        globalEmitter.once(`stopCampaign-${campaign.name}`, () => {
            clearInterval(timerId)
            console.log(`Stopped Campaign: ${campaign.name}`)
        })
        reply.send('Sending Campaign')
      }
  }
})

fastify.route({
  method: ['PUT'],
  url: '/schedule_campaign',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Set a time to send the campaign',
      tags: ['Campaign'],
      summary: 'scheddule the campaign',
      body: {
        type: 'object',
        properties: {
          campaign: {
            type: 'string',
            description: 'campaign name'
          },
          start_time:{
            type: 'number',
            description: 'linux epoch time to start the campaign'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'string'
        }
      }
  },
  handler: async function (req, reply) {
      let campaign_query = db.prepare(`
        SELECT * FROM campaigns WHERE name = $campaign
      `)
      let campaign = campaign_query.get({"campaign": req.body["campaign"]})
      if(campaign.is_sending == 1){
        reply.send('WARNING: you are already sending this campaign')
      }else{
        let set_start = db.prepare(`
          UPDATE campaigns SET (scheduled_start, is_sending) = ($scheduled_start, 1) WHERE name = $campaign
        `)
        let start_time = req.body["start_time"]
        set_start.run({scheduled_start: start_time, campaign: campaign.name})
        let timeout = start_time - (new Date().getTime())
        let timeoutID = setTimeout(function(){
          sendCampaign(campaign, fastify.io)
          let timerId = setInterval(function(){sendCampaign(campaign, fastify.io)}, campaign.delay * 1000)
          globalEmitter.once(`stopCampaign-${campaign.name}`, () => {
              clearInterval(timerId)
              console.log(`Stopped Scheduled Campaign: ${campaign.name}`)
          })
        }, timeout)
        globalEmitter.once(`stopCampaign-${campaign.name}`, () => {
          clearTimeout(timeoutID)
          console.log(`Stopped Scheduled Campaign: ${campaign.name}`)
        })
        reply.send('Scheduled Campaign')
      }
  }
})

fastify.route({
  method: ['PUT'],
  url: '/cancel_campaign',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Stop sending the campaign',
      tags: ['Campaign'],
      summary: 'stop sending the campaign',
      body: {
        type: 'object',
        properties: {
          campaign: {
            type: 'string',
            description: 'campaign name'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'string'
        }
      }
  },
  handler: async function (req, reply) {
    let campaign = req.body["campaign"]
    console.log(`stopping campaign: ${campaign} - Cancelled`)
    let set_end = db.prepare(`
      UPDATE campaigns SET (end_timestamp, is_sending) = ($end_time, 0) WHERE name = $campaign
    `)
    let end_time = new Date().getTime()
    set_end.run({end_time: end_time, campaign: req.body["campaign"]})
    globalEmitter.emit(`stopCampaign-${campaign}`)
    reply.send('Cancelled Campaign')
  }
})

fastify.route({
  method: ['GET'],
  url: '/get_targets',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Get all targets for a campaign',
      tags: ['Target'],
      summary: 'get campaign targets',
      querystring: {
        type: 'object',
        properties: {
          campaign: {
            type: 'string',
            description: 'campaign name'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'array'
        }
      }
  },
  handler: async function (req, reply) {
      let targets_query = db.prepare(`
        SELECT * FROM targets WHERE campaign = $campaign
      `)
      let targets = targets_query.all({"campaign": req.query["campaign"]})
      reply.type('application/json').send(JSON.stringify(targets))
  }
})

fastify.route({
  method: ['POST'],
  url: '/create_target',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Add a target to a campaign',
    tags: ['Target'],
    summary: 'create target',
    body: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'target email address'
        },
        campaign: {
          type: 'string',
          description: 'campaign to add the target to'
        },
        first_name:{
          type: 'string',
          description: 'First name of the target'
        },
        last_name: {
          type: 'string',
          description: 'Last name of the target'
        },
        position:{
          type: 'string',
          description: 'job title of the target'
        },
        custom: {
          type: 'string',
          description: 'Custom attribute/info to track like a phone number etc.'
        },
        phished: {
          type: 'number',
          description: '0 if the user has not been phished yet, 1 if they have'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'target email address'
          },
          campaign: {
            type: 'string',
            description: 'campaign to add the target to'
          },
          first_name:{
            type: 'string',
            description: 'First name of the target'
          },
          last_name: {
            type: 'string',
            description: 'Last name of the target'
          },
          position:{
            type: 'string',
            description: 'job title of the target'
          },
          custom: {
            type: 'string',
            description: 'Custom attribute/info to track like a phone number etc.'
          },
          phished: {
            type: 'number',
            description: '0 if the user has not been phished yet, 1 if they have'
          },
          target_id: {
            type: 'string',
            description: 'unique target ID for this target'
          }
        }
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":saved target: \n")
    let target = req.body
    target.target_id = Math.random().toString(36).slice(2).substr(0, 6)
    let new_target = db.prepare(`
      INSERT INTO targets VALUES (
        $target_id,
        $address,
        $campaign,
        $first_name,
        $last_name,
        $position,
        $custom,
        $phished
      )
    `)
    new_target.run({
      target_id: target.target_id,
      address: target.address,
      campaign: target.campaign,
      first_name: target.first_name,
      last_name: target.last_name,
      position: target.position,
      custom: target.custom,
      phished: 0
    })
    reply.code(200).send(target)
  }
})

fastify.route({
  method: ['DELETE'],
  url: '/delete_target',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Remove target from a campaign',
    tags: ['Target'],
    summary: 'delete target',
    body: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'target email address'
        },
        campaign: {
          type: 'string',
          description: 'campaign to remove the target from'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":deleted target: \n")
    let old_target = req.body
    let get_target_id = db.prepare(`
      SELECT target_id FROM targets WHERE address = $address AND campaign = $campaign
    `).pluck()
    let target_id = get_target_id.get({
      address: old_target.address,
      campaign: old_target.campaign
    })
    let remove_target = db.prepare(`
      DELETE FROM targets WHERE address = $address AND campaign = $campaign
    `)
    remove_target.run({
      address: old_target.address,
      campaign: old_target.campaign
    })
    let remove_events = db.prepare(`
      DELETE FROM events WHERE target = $target
    `)
    remove_events.run({
      target: target_id
    })
    reply.code(200).send(old_target.address)
  }
})

fastify.route({
  method: ['PUT'],
  url: '/update_phished_status',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Change the phished status of a target',
    tags: ['Target'],
    summary: 'update phished status',
    body: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'target email address'
        },
        campaign: {
          type: 'string',
          description: 'campaign to add the target to'
        },
        phished: {
          type: 'number',
          description: 'phished status 0 or 1'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'target email address'
          },
          campaign: {
            type: 'string',
            description: 'campaign to add the target to'
          },
          phished: {
            type: 'number',
            description: 'phished status 0 or 1'
          }
        }
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":updated target: \n")
    let target = req.body
    let update_target = db.prepare(`
      UPDATE targets SET phished = $phished WHERE address = $address AND campaign = $campaign
    `)
    update_target.run({
      phished: target.phished,
      address: target.address,
      campaign: target.campaign
    })
    reply.code(200).send(target)
  }
})

fastify.route({
  method: ['GET'],
  url: '/get_target_info',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Get basic info for a target',
      tags: ['Target'],
      summary: 'get target info',
      querystring: {
        type: 'object',
        properties: {
          target_id: {
            type: 'string',
            description: 'unique target ID'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'target email address'
            },
            campaign: {
              type: 'string',
              description: 'campaign to add the target to'
            },
            first_name:{
              type: 'string',
              description: 'First name of the target'
            },
            last_name: {
              type: 'string',
              description: 'Last name of the target'
            },
            position:{
              type: 'string',
              description: 'job title of the target'
            },
            custom: {
              type: 'string',
              description: 'Custom attribute/info to track like a phone number etc.'
            },
            phished: {
              type: 'number',
              description: '0 if the user has not been phished yet, 1 if they have'
            },
            target_id: {
              type: 'string',
              description: 'unique target ID for this target'
            }
          }
        }
      }
  },
  handler: async function (req, reply) {
      let target_query = db.prepare(`
        SELECT * FROM targets WHERE target_id = $target_id
      `)
      let target = target_query.get({target_id: req.query['target_id']})
      reply.type('application/json').send(target)
  }
})

fastify.route({
  method: ['GET'],
  url: '/get_target_events',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Get all events for a target',
      tags: ['Event'],
      summary: 'get target events',
      querystring: {
        type: 'object',
        properties: {
          target_id: {
            type: 'string',
            description: 'unique target ID'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'array'
      }
    }
  },
  handler: async function (req, reply) {
    let events_query = db.prepare(`
      SELECT * FROM events WHERE ignore = 0 AND target = $target_id
    `)
    let events = events_query.all({target_id: req.query['target_id']})
    reply.type('application/json').send(events)
  }
})

fastify.route({
  method: ['GET'],
  url: '/get_search_events',
  schema: {
      security: [{cookieAuth: []}],
      description: 'Get all events for a search query',
      tags: ['Event'],
      summary: 'search events',
      querystring: {
        type: 'object',
        properties: {
          campaign: {
            type: 'string',
            description: 'campaign to search'
          },
          timestamp: {
            type: 'string',
            description: 'search for a particular timestamp'
          },
          event_type: {
            type: 'string',
            description: 'the TYPE of the event'
          },
          source: {
            type: 'string',
            description: 'the source IP of the event'
          },
          target: {
            type: 'string',
            description: 'the target ID to search'
          },
          data: {
            type: 'string',
            description: 'search the actual data of the event'
          }
        }
      },
      response: {
        200: {
          description: 'Successful response',
          type: 'array'
      }
    }
  },
  handler: async function (req, reply) {
    let events_query = db.prepare(`
      SELECT * FROM events
        WHERE ignore = 0
        AND campaign = $campaign
        AND event_timestamp LIKE $timestamp
        AND event_ip LIKE $source
        AND target LIKE $target
        AND event_type LIKE $event_type
        AND event_data LIKE $data
    `)
    let events = events_query.all({
      campaign: req.query['campaign'],
      target_id: `%${req.query['target_id']}%`,
      timestamp: `%${req.query['timestamp']}%`,
      source: `%${req.query['source']}%`,
      target: `%${req.query['target']}%`,
      event_type: `%${req.query['event_type']}%`,
      data: `%${req.query['data']}%`
    })
    reply.type('application/json').send(events)
  }
})

fastify.route({
  method: ['PUT'],
  url: '/ignore_event',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Change the ignore status of an event',
    tags: ['Event'],
    summary: 'ignore event',
    body: {
      type: 'object',
      properties: {
        campaign: {
          type: 'string',
          description: 'campaign for the event'
        },
        timestamp: {
          type: 'string',
          description: 'event timestamp'
        },
        event_type: {
          type: 'string',
          description: 'event TYPE'
        },
        source: {
          type: 'string',
          description: 'the source IP of the event'
        },
        target: {
          type: 'string',
          description: 'the target ID associated with the event'
        },
        data: {
          type: 'string',
          description: 'data of the event'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":updated target: \n")
    let myevent = req.body
    let update_event = db.prepare(`
      UPDATE events SET ignore = 1 WHERE 
        campaign = $campaign
        AND event_timestamp = $timestamp 
        AND event_ip = $source 
        AND target = $target 
        AND event_type = $event_type
    `)
    update_event.run({
      campaign: myevent.campaign,
      timestamp: myevent.timestamp,
      source: myevent.source,
      target: myevent.target,
      event_type: myevent.event_type
    })
    reply.code(200).send('event updated')
  }
})

fastify.route({
  method: ['PUT'],
  url: '/unignore_events',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Allow all events to show up in search queries',
    tags: ['Event'],
    summary: 'unignore events',
    body: {
      type: 'object',
      properties: {
        campaign: {
          type: 'string',
          description: 'campaign for the event'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":updated target: \n")
    let campaign = req.body.campaign
    let update_events = db.prepare(`
      UPDATE events SET ignore = 0 WHERE campaign = $campaign
    `)
    update_events.run({
      campaign: campaign
    })
    reply.code(200).send('events unignored')
  }
})

fastify.route({
  method: ['DELETE'],
  url: '/delete_campaign',
  schema:{
    security: [{cookieAuth: []}],
    description: 'Delete an entire campaign and associated events',
    tags: ['Campaign'],
    summary: 'delete campaign',
    body: {
      type: 'object',
      properties: {
        campaign: {
          type: 'string',
          description: 'campaign name to delete'
        }
      }
    },
    response: {
      200: {
        description: 'Successful response',
        type: 'string'
      }
    }
  },
  handler: async function (req, reply) {
    console.log(":deleted campaign: \n")
    let campaign = req.body.campaign
    let remove_targets = db.prepare(`
      DELETE FROM targets WHERE campaign = $campaign
    `)
    remove_targets.run({
      campaign: campaign
    })
    let remove_events = db.prepare(`
      DELETE FROM events WHERE campaign = $campaign
    `)
    remove_events.run({
      campaign: campaign
    })
    let remove_campaign = db.prepare(`
      DELETE FROM campaigns WHERE name = $campaign
    `)
    remove_campaign.run({
      campaign: campaign
    })
    reply.code(200).send('campaign deleted')
  }
})

//helper to get image data from URLs
fastify.route({
  method: ['POST'],
  url: '/get_base64_for_image',
  handler: async function (req, reply) {
    let image = await got(req.body.image_url)
    reply.send(image.rawBody.toString('base64'))
  }
}) 

//flow-through to the phishmarket server
fastify.route({
  method: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS'],
  url: '/phishmarket/*',
  handler: async function (req, reply) {
    let raw_req = req.raw
    raw_req.hostname = 'localhost'
    let request_options = {
      followRedirect: false,
      throwHttpErrors: false,
      https: {rejectUnauthorized: false},
      headers: raw_req.headers,
      method: raw_req.method
    }
    if(req.body != null){
      request_options.body = JSON.stringify(req.body)
    }
    raw_req.headers["Authorization"] = `Bearer ${config.phishmarket.token}`
    api_data = await got(config.phishmarket.url + raw_req.url, request_options)
    reply.headers(api_data.headers)
    reply.code(api_data.statusCode)
    reply.send(api_data.rawBody)
  }
}) 

//static phishmarket html
fastify.route({
  method: ['GET'],
  url: '/phishmarket',
  handler: async function (req, reply) {
    let stream = fs.createReadStream(__dirname + "/resources/pages/phishmarket.html")
    reply.type('text/html').send(stream)
  }
}) 

fastify.ready(function(err){
    if (err) throw err
    fastify.io.on('connect', function(socket){
        console.info('Socket connected!', socket.id)
        socket.on("capture_email", function(data) {
            console.log("capturing email")
            captureMail(fastify.io)
            fastify.io.emit("capture_started", {})
        })
    })
})

// Run the server!
const start = async () => {
    fastify.listen(4005, (err) => {
      if (err) {
        fastify.log.error(err)
        process.exit(1)
      }
      fastify.log.info(`server listening on ${fastify.server.address().port}`)
    })
  }
  start()