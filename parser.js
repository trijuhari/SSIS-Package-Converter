/**
 * parser.js — DTSX (SSIS Package XML) Parser
 * Parses a .dtsx XML file and returns a structured JSON representation
 * of the SSIS package components.
 */

const SSISParser = (() => {

  const DTS_NS = 'www.microsoft.com/SqlServer/Dts';

  /**
   * Main entry: parse raw XML string → structured PackageInfo object
   */
  function parse(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    const parseErr = doc.querySelector('parsererror');
    if (parseErr) {
      throw new Error('Invalid XML: ' + parseErr.textContent.split('\n')[0]);
    }

    const root = doc.documentElement;
    const info = {
      name:          getAttr(root, 'ObjectName') || getAttr(root, 'DTS:ObjectName') || 'UnnamedPackage',
      description:   getAttr(root, 'Description') || getAttr(root, 'DTS:Description') || '',
      creatorName:   getAttr(root, 'CreatorName') || getAttr(root, 'DTS:CreatorName') || '',
      creatorComputerName: getAttr(root, 'CreatorComputerName') || '',
      version:       getAttr(root, 'VersionBuild') || '',

      connectionManagers: [],
      executables:        [],   // tasks
      variables:          [],
      parameters:         [],
      dataFlows:          [],   // Data Flow Tasks with components
      sqlTasks:           [],
      otherTasks:         [],
    };

    // 1. Connection Managers
    info.connectionManagers = parseConnectionManagers(doc);

    // 2. Variables
    info.variables = parseVariables(doc);

    // 3. Parameters
    info.parameters = parseParameters(doc);

    // 4. Executables (tasks)
    const { dataFlows, sqlTasks, otherTasks } = parseExecutables(doc, info.connectionManagers);
    info.dataFlows = dataFlows;
    info.sqlTasks  = sqlTasks;
    info.otherTasks = otherTasks;
    info.executables = [...dataFlows, ...sqlTasks, ...otherTasks];

    return info;
  }

  /* ── Connection Managers ─────────────────────────────────────── */
  function parseConnectionManagers(doc) {
    const cms = [];
    // Try both namespaced and non-namespaced
    const cmNodes = [
      ...doc.querySelectorAll('ConnectionManagers ConnectionManager'),
      ...Array.from(doc.getElementsByTagNameNS('*', 'ConnectionManager')),
    ];
    const seen = new Set();

    cmNodes.forEach(cm => {
      const id = getAnyAttr(cm, 'DTSID');
      if (seen.has(id)) return;
      seen.add(id);

      const name         = getAnyAttr(cm, 'ObjectName') || 'Connection';
      const connString   = getAnyAttr(cm, 'ConnectionString') || '';
      const creationName = getAnyAttr(cm, 'CreationName') || '';
      const description  = getAnyAttr(cm, 'Description') || '';

      // Detect type
      let type = 'OTHER';
      const cn = creationName.toUpperCase();
      if (cn.includes('OLEDB') || cn.includes('OLE DB')) type = 'OLEDB';
      else if (cn.includes('ADO.NET') || cn.includes('ADONET')) type = 'ADONET';
      else if (cn.includes('FLATFILE') || cn.includes('FLAT FILE')) type = 'FLATFILE';
      else if (cn.includes('EXCEL')) type = 'EXCEL';
      else if (cn.includes('FILE')) type = 'FILE';
      else if (cn.includes('HTTP')) type = 'HTTP';
      else if (cn.includes('FTP'))  type = 'FTP';
      else if (cn.includes('SMTP')) type = 'SMTP';
      else if (cn.includes('MSOLAP') || cn.includes('ANALYSIS')) type = 'SSAS';

      // Try to parse server/database from connection string
      const server   = extractConnParam(connString, ['Server', 'Data Source']);
      const database = extractConnParam(connString, ['Database', 'Initial Catalog']);

      cms.push({ id, name, type, creationName, connString, server, database, description });
    });

    return cms;
  }

  /* ── Variables ───────────────────────────────────────────────── */
  function parseVariables(doc) {
    const vars = [];
    const varNodes = [
      ...doc.querySelectorAll('Variables Variable'),
      ...Array.from(doc.getElementsByTagNameNS('*', 'Variable')),
    ];
    const seen = new Set();

    varNodes.forEach(v => {
      const name = getAnyAttr(v, 'ObjectName');
      if (!name || seen.has(name)) return;
      seen.add(name);

      const ns    = getAnyAttr(v, 'Namespace') || 'User';
      const dtype = getAnyAttr(v, 'DataType') || '8'; // 8=String
      const expr  = getAnyAttr(v, 'Expression') || '';
      let value   = '';

      // Value might be in a child element
      const valEl = v.querySelector('VariableValue');
      if (valEl) value = valEl.textContent.trim();

      vars.push({ name, namespace: ns, dataType: dtypeToStr(dtype), expression: expr, value });
    });

    return vars;
  }

  /* ── Parameters ──────────────────────────────────────────────── */
  function parseParameters(doc) {
    const params = [];
    const paramNodes = Array.from(doc.getElementsByTagNameNS('*', 'PackageParameter'))
      .concat(Array.from(doc.querySelectorAll('PackageParameters PackageParameter')));
    const seen = new Set();

    paramNodes.forEach(p => {
      const name = getAnyAttr(p, 'ObjectName');
      if (!name || seen.has(name)) return;
      seen.add(name);
      const dtype = getAnyAttr(p, 'DataType') || '8';
      params.push({ name, dataType: dtypeToStr(dtype) });
    });

    return params;
  }

  /* ── Executables (Tasks) ─────────────────────────────────────── */
  function parseExecutables(doc, connectionManagers) {
    const dataFlows  = [];
    const sqlTasks   = [];
    const otherTasks = [];

    // Find all Executable elements
    const exeNodes = Array.from(doc.getElementsByTagNameNS('*', 'Executable'));

    exeNodes.forEach(exe => {
      const creationName = getAnyAttr(exe, 'CreationName') || '';
      const name         = getAnyAttr(exe, 'ObjectName') || 'Task';
      const description  = getAnyAttr(exe, 'Description') || '';
      const execId       = getAnyAttr(exe, 'DTSID') || '';

      const cn = creationName.toLowerCase();

      if (cn.includes('pipeline') || cn.includes('dataflow') || cn.includes('data flow') || cn.includes('microsoft.pipeline')) {
        // Data Flow Task
        const df = parseDataFlowTask(exe, name, description, execId, connectionManagers);
        dataFlows.push(df);

      } else if (cn.includes('microsoft.executesqltask') || cn.includes('executesql')) {
        // Execute SQL Task
        const st = parseSQLTask(exe, name, description, execId, connectionManagers);
        sqlTasks.push(st);

      } else if (cn.includes('sequence') || cn.includes('foreach') || cn.includes('for loop')) {
        // Container — recurse for children
        const { dataFlows: cdf, sqlTasks: cst, otherTasks: cot } = parseExecutables(exe, connectionManagers);
        dataFlows.push(...cdf);
        sqlTasks.push(...cst);
        otherTasks.push(...cot);

      } else {
        otherTasks.push({ name, description, creationName, id: execId });
      }
    });

    return { dataFlows, sqlTasks, otherTasks };
  }

  /* ── Data Flow Task ──────────────────────────────────────────── */
  function parseDataFlowTask(exe, name, description, id, connectionManagers) {
    const df = {
      type: 'DataFlow',
      name, description, id,
      sources:       [],
      destinations:  [],
      transformations: [],
      components:    [],
    };

    // Components live under ObjectData > pipeline > components
    const components = Array.from(exe.getElementsByTagNameNS('*', 'component'));
    if (!components.length) {
      // Try non-namespaced
      exe.querySelectorAll('component').forEach(c => components.push(c));
    }

    components.forEach(comp => {
      const compName  = comp.getAttribute('name') || comp.getAttribute('componentClassID') || 'Component';
      const classId   = (comp.getAttribute('componentClassID') || '').toLowerCase();
      const desc      = comp.getAttribute('description') || '';

      // Detect columns
      const cols = [];
      comp.querySelectorAll('outputColumn, inputColumn').forEach(col => {
        const cn = col.getAttribute('name') || col.getAttribute('cachedName');
        const dt = col.getAttribute('dataType') || col.getAttribute('cachedDataType') || '';
        if (cn) cols.push({ name: cn, dataType: ssisDtypeToSQL(dt) });
      });

      // Detect connection
      let connRef = '';
      comp.querySelectorAll('property').forEach(prop => {
        const pn = prop.getAttribute('name') || '';
        if (pn === 'OpenRowset' || pn === 'TableOrViewName' || pn === 'SqlCommand') {
          connRef = prop.textContent.trim();
        }
      });

      const connectionManagerID = comp.getAttribute('connectionManagerID') || '';
      const connMgr = connectionManagers.find(c => c.id === connectionManagerID);

      const compInfo = { name: compName, classId, description: desc, columns: cols, connRef, connectionManager: connMgr || null };

      // Categorize
      if (classId.includes('source') || classId.includes('src') || classId.includes('oledbsource') || classId.includes('flatfilesource')) {
        df.sources.push(compInfo);
      } else if (classId.includes('dest') || classId.includes('oledbdestination') || classId.includes('flatfiledestination')) {
        df.destinations.push(compInfo);
      } else {
        df.transformations.push(compInfo);
      }

      df.components.push(compInfo);
    });

    // Fallback: if no components found, try to infer from properties
    if (!df.components.length) {
      df.sources.push({ name: name + '_Source', classId: 'source', columns: [], connRef: '', connectionManager: connectionManagers[0] || null });
      df.destinations.push({ name: name + '_Dest', classId: 'destination', columns: [], connRef: '', connectionManager: connectionManagers[1] || connectionManagers[0] || null });
    }

    return df;
  }

  /* ── Execute SQL Task ────────────────────────────────────────── */
  function parseSQLTask(exe, name, description, id, connectionManagers) {
    const st = { type: 'ExecuteSQL', name, description, id, sqlStatement: '', connection: null };

    // Look for SqlStatementSource in ObjectData
    const objData = exe.querySelector('ObjectData') || exe;
    const sqlTaskNode = objData.querySelector('SqlTaskData') || objData;

    st.sqlStatement = sqlTaskNode.getAttribute('SqlStatementSource')
      || sqlTaskNode.getAttribute('DTS:SqlStatementSource')
      || '';

    const connId = sqlTaskNode.getAttribute('Connection')
      || sqlTaskNode.getAttribute('DTS:Connection')
      || '';

    st.connection = connectionManagers.find(c => c.id === connId || c.name === connId) || connectionManagers[0] || null;

    return st;
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function getAttr(el, name) {
    return el.getAttribute(name) || el.getAttributeNS(DTS_NS, name) || null;
  }

  function getAnyAttr(el, name) {
    // Try plain, then DTS: prefixed, then namespace
    return el.getAttribute(name)
      || el.getAttribute('DTS:' + name)
      || el.getAttributeNS(DTS_NS, name)
      || null;
  }

  function extractConnParam(connStr, keys) {
    for (const key of keys) {
      const re = new RegExp(key + '\\s*=\\s*([^;]+)', 'i');
      const m  = connStr.match(re);
      if (m) return m[1].trim();
    }
    return '';
  }

  function dtypeToStr(code) {
    const map = { '2': 'int', '3': 'int', '4': 'float', '5': 'float', '6': 'decimal', '7': 'datetime', '8': 'str', '11': 'bool', '14': 'decimal', '16': 'int', '17': 'int', '18': 'str', '19': 'int', '20': 'int', '21': 'float', '128': 'bytes' };
    return map[String(code)] || 'str';
  }

  function ssisDtypeToSQL(dt) {
    const map = {
      'str': 'NVARCHAR(255)', 'wstr': 'NVARCHAR(255)', 'i1': 'TINYINT', 'i2': 'SMALLINT',
      'i4': 'INT', 'i8': 'BIGINT', 'ui1': 'TINYINT', 'ui2': 'SMALLINT', 'ui4': 'INT',
      'ui8': 'BIGINT', 'r4': 'FLOAT', 'r8': 'FLOAT', 'cy': 'DECIMAL(19,4)',
      'decimal': 'DECIMAL(18,2)', 'numeric': 'DECIMAL(18,2)', 'dbDate': 'DATE',
      'dbTime': 'TIME', 'dbTimeStamp': 'DATETIME2', 'bool': 'BIT', 'image': 'VARBINARY(MAX)',
      'text': 'NVARCHAR(MAX)', 'ntext': 'NVARCHAR(MAX)', 'guid': 'UNIQUEIDENTIFIER',
    };
    return map[dt] || 'NVARCHAR(255)';
  }

  /**
   * Generate a "demo" package when the XML can't be parsed or is empty.
   * This simulates what a typical SSIS customer pipeline looks like.
   */
  function generateDemoPackage(name = 'DemoPackage') {
    return {
      name,
      description: 'Demo package for SSIS Modernizer preview',
      creatorName:  'SSIS Modernizer Demo',
      version: '1',
      connectionManagers: [
        { id: '{CM-001}', name: 'OLTP_Connection',    type: 'OLEDB', server: 'SQL-SERVER-01', database: 'OperationalDB',  connString: 'Data Source=SQL-SERVER-01;Initial Catalog=OperationalDB' },
        { id: '{CM-002}', name: 'Landing_Connection', type: 'OLEDB', server: 'SQL-SERVER-02', database: 'LandingZone',    connString: 'Data Source=SQL-SERVER-02;Initial Catalog=LandingZone' },
        { id: '{CM-003}', name: 'DWH_Connection',     type: 'OLEDB', server: 'SQL-DWH-01',   database: 'DataWarehouse',  connString: 'Data Source=SQL-DWH-01;Initial Catalog=DataWarehouse' },
      ],
      variables: [
        { name: 'RunDate',    namespace: 'User', dataType: 'str',  value: '' },
        { name: 'BatchSize',  namespace: 'User', dataType: 'int',  value: '10000' },
        { name: 'SourceEnv',  namespace: 'User', dataType: 'str',  value: 'PROD' },
      ],
      parameters: [
        { name: 'RunDate', dataType: 'str' },
        { name: 'Environment', dataType: 'str' },
      ],
      dataFlows: [
        {
          type: 'DataFlow', name: 'Load_Customer_Data', description: 'Extract and load customer data from OLTP to landing zone',
          sources: [{ name: 'OLTP_Customer_Source', classId: 'oledbsource', columns: [
            { name: 'customer_id', dataType: 'INT' }, { name: 'customer_name', dataType: 'NVARCHAR(255)' },
            { name: 'customer_type_code', dataType: 'NVARCHAR(10)' }, { name: 'registration_date', dataType: 'DATE' },
            { name: 'is_active', dataType: 'BIT' }, { name: 'last_modified_date', dataType: 'DATETIME2' },
          ], connRef: 'dbo.customer', connectionManager: { name: 'OLTP_Connection', server: 'SQL-SERVER-01', database: 'OperationalDB' } }],
          destinations: [{ name: 'Landing_Customer_Dest', classId: 'oledbdestination', columns: [
            { name: 'customer_id', dataType: 'INT' }, { name: 'customer_name', dataType: 'NVARCHAR(255)' },
            { name: 'customer_type_code', dataType: 'NVARCHAR(10)' }, { name: 'registration_date', dataType: 'DATE' },
            { name: 'is_active', dataType: 'BIT' }, { name: 'last_modified_date', dataType: 'DATETIME2' },
          ], connRef: 'landing.raw_customer', connectionManager: { name: 'Landing_Connection', server: 'SQL-SERVER-02', database: 'LandingZone' } }],
          transformations: [
            { name: 'DerivedColumn_Metadata', classId: 'derivedcolumn', columns: [{ name: '_run_date', dataType: 'DATE' }, { name: '_loaded_at', dataType: 'DATETIME2' }] },
            { name: 'DataConversion_TypeCode', classId: 'dataconversion', columns: [{ name: 'customer_type_code', dataType: 'NVARCHAR(10)' }] },
          ],
          components: [],
        },
        {
          type: 'DataFlow', name: 'Load_Loan_Data', description: 'Extract and load loan data from OLTP to landing zone',
          sources: [{ name: 'OLTP_Loan_Source', classId: 'oledbsource', columns: [
            { name: 'loan_id', dataType: 'INT' }, { name: 'customer_id', dataType: 'INT' },
            { name: 'outstanding_amount', dataType: 'DECIMAL(19,4)' }, { name: 'loan_date', dataType: 'DATE' },
            { name: 'loan_status', dataType: 'NVARCHAR(20)' },
          ], connRef: 'dbo.loan', connectionManager: { name: 'OLTP_Connection', server: 'SQL-SERVER-01', database: 'OperationalDB' } }],
          destinations: [{ name: 'Landing_Loan_Dest', classId: 'oledbdestination', columns: [
            { name: 'loan_id', dataType: 'INT' }, { name: 'customer_id', dataType: 'INT' },
            { name: 'outstanding_amount', dataType: 'DECIMAL(19,4)' }, { name: 'loan_date', dataType: 'DATE' },
            { name: 'loan_status', dataType: 'NVARCHAR(20)' },
          ], connRef: 'landing.raw_loan', connectionManager: { name: 'Landing_Connection', server: 'SQL-SERVER-02', database: 'LandingZone' } }],
          transformations: [],
          components: [],
        },
      ],
      sqlTasks: [
        {
          type: 'ExecuteSQL', name: 'Truncate_Staging_Tables', description: 'Clean staging before load',
          sqlStatement: 'TRUNCATE TABLE landing.raw_customer; TRUNCATE TABLE landing.raw_loan;',
          connection: { name: 'Landing_Connection', server: 'SQL-SERVER-02', database: 'LandingZone' },
        },
      ],
      otherTasks: [
        { name: 'Send_Completion_Email', description: 'Send notification email after pipeline completes', creationName: 'Microsoft.SendMailTask' },
      ],
      executables: [],
    };
  }

  return { parse, generateDemoPackage };
})();
