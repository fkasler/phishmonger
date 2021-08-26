exports.options = {
    routePrefix: '/documentation',
    exposeRoute: true,
    hideUntagged: true,
    swagger: {
      info: {
        title: 'Phishmonger API',
        description: 'Phishing for the masses',
        version: '2.0.0'
      },
      externalDocs: {
        url: 'https://github.com/fastify/fastify-swagger',
        description: 'Find more info here'
      },
      host: 'yourservernamehere',
      schemes: ['https'],
      consumes: ['application/json'],
      produces: ['application/json'],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'admin_cookie'
          }
        }
      }
    }
  }
