export const TICKET_CONFIG = Object.freeze({
  supportChannelId: '1529630773768884256',
  ticketsCategoryId: '1529639303947489411',
  ticketLogsChannelId: '1529629945721131029',
  roles: Object.freeze({
    trialAdmin: '1538483009718853732',
    admin: '1529643473152770058',
    seniorAdmin: '1538451886758170744',
    owner: '1529632873987178668',
    discordModerator: '1547296028913311774',
    discordAdmin: '1540715768625496135',
    traineePilot: '1546935180713926766',
    traineeDroneOperator: '1548325333327945758'
  }),
});

const R = TICKET_CONFIG.roles;

export const TICKET_TYPES = Object.freeze({
  player_report: Object.freeze({
    label: 'Player Report / Issue',
    description: 'Report a player or request assistance with an issue.',
    initialRoleIds: [R.trialAdmin, R.admin],
    escalationLevels: [[R.seniorAdmin], [R.owner]],
    instructions: [
      '**Thank you for contacting the TLC Team.**',
      'Please describe your issue and wait for a response.',
      'Please provide the **Gamer ID** of the player being reported.',
      'Please provide a **link or clip** of the incident.'
    ].join('\n')
  }),

  official_unit: Object.freeze({
    label: 'Official Unit Application',
    description: 'Apply for recognition as an Official TLC Unit.',
    initialRoleIds: [R.discordModerator],
    escalationLevels: [[R.discordAdmin, R.owner]],
    instructions: [
      '**Thank you for your interest in becoming an Official TLC Unit.**',
      'Please provide all information requested in the **pinned message** at the top of **#🎖️│tlc-official-units**.'
    ].join('\n')
  }),

  content_creator: Object.freeze({
    label: 'Content Creator Application',
    description: 'Apply for the TLC Content Creator role.',
    initialRoleIds: [R.discordModerator],
    escalationLevels: [],
    instructions: [
      '**Thank you for your interest in becoming a TLC Content Creator.**',
      'A member of the TLC Team will provide you with the requirements, rules, and next steps shortly.'
    ].join('\n')
  }),

  donator_support: Object.freeze({
    label: 'Donator Support',
    description: 'Verify your donation and receive your Donator role.',
    initialRoleIds: [R.discordModerator],
    escalationLevels: [[R.owner]],
    instructions: [
      '**Thank you for supporting TLC.**',
      'Please provide **proof of your donation**.',
      'Once verified, a member of the TLC Team will assign you the appropriate **Donator role**.'
    ].join('\n')
  }),

  developer_application: Object.freeze({
    label: 'Developer Application',
    description: 'Apply to join the TLC Development Team.',
    initialRoleIds: [R.owner],
    escalationLevels: [],
    instructions: [
      '**Thank you for contacting the TLC Team.**',
      'Please tell us a few things about your **development experience and skills**.'
    ].join('\n')
  }),

  dedicated_pilot: Object.freeze({
    label: 'Dedicated Pilot Application',
    description: 'Apply to begin the Dedicated Pilot process.',
    initialRoleIds: [R.discordModerator],
    openingPingRoleIds: [R.owner, R.seniorAdmin, R.discordAdmin],
    traineeApproval: Object.freeze({
      roleId: R.traineePilot,
      roleName: 'Trainee Pilot',
      nextRoleName: 'Dedicated Pilot',
      accessChannelName: 'trainee pilot channel',
      evaluationText: 'A member of the team will contact you there when possible to arrange your evaluation.'
    }),
    escalationLevels: [],
    instructions: [
      '**Thank you for your interest in becoming a TLC Dedicated Pilot.**',
      'A member of the TLC Team will assist you shortly and explain the next steps of the process.'
    ].join('\n')
  }),

  drone_operator: Object.freeze({
    label: 'Drone Operator Application',
    description: 'Apply to begin the Drone Operator process.',
    initialRoleIds: [R.discordModerator],
    openingPingRoleIds: [R.owner, R.seniorAdmin, R.discordAdmin],
    traineeApproval: Object.freeze({
      roleId: R.traineeDroneOperator,
      roleName: 'Trainee Drone Operator',
      nextRoleName: 'Dedicated Drone Operator',
      accessChannelName: 'trainee drone operator channel',
      evaluationText: 'A member of the team will contact you there when possible to arrange your training and evaluation.'
    }),
    escalationLevels: [],
    instructions: [
      '**Thank you for your interest in becoming a TLC Drone Operator.**',
      'A member of the TLC Team will assist you shortly and explain the Drone Operator Program, requirements, and evaluation process.'
    ].join('\n')
  })
});

export const TICKET_CLOSE_OVERRIDE_ROLE_IDS = Object.freeze([
  R.discordAdmin,
  R.owner,
  R.seniorAdmin
]);

export const TICKET_TRAINEE_APPROVER_ROLE_IDS = Object.freeze([
  R.owner,
  R.seniorAdmin,
  R.discordAdmin
]);
