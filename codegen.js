/**
 * codegen.js — Code Generator for SSIS Modernizer
 * Generates the target modernization files (Python, dbt, Airflow, configs) from parsed PackageInfo.
 * This generator is enhanced with Banking SLA, Secrets Management, Reconciliation Tests, dbt Snapshots, and Custom Data Checks.
 */

const SSISCodegen = (() => {

  /**
   * Main generation entrypoint
   */
  function generate(packageInfo) {
    const pkgName = (packageInfo.name || 'ssis_package').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    const files = {
      python: [],
      dbt: [],
      airflow: [],
      config: []
    };

    // 1. Python Ingestion Scripts & Validation
    packageInfo.dataFlows.forEach(df => {
      const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      
      // Extraction Script
      files.python.push({
        path: `ingestion/${flowName}/extract_${flowName}.py`,
        name: `extract_${flowName}.py`,
        language: 'python',
        content: generatePythonExtract(df, flowName, packageInfo)
      });

      // Validation Script (Pandera)
      files.python.push({
        path: `ingestion/${flowName}/validate_${flowName}.py`,
        name: `validate_${flowName}.py`,
        language: 'python',
        content: generatePythonValidate(df, flowName)
      });
    });

    // Ingestion Utils (Centralized)
    files.python.push({
      path: `ingestion/utils/db.py`,
      name: 'db.py',
      language: 'python',
      content: generatePythonDbUtil()
    });
    files.python.push({
      path: `ingestion/utils/logger.py`,
      name: 'logger.py',
      language: 'python',
      content: generatePythonLoggerUtil()
    });
    files.python.push({
      path: `ingestion/utils/secrets.py`,
      name: 'secrets.py',
      language: 'python',
      content: generatePythonSecretsUtil()
    });
    files.python.push({
      path: `ingestion/utils/api_client.py`,
      name: 'api_client.py',
      language: 'python',
      content: generatePythonApiClient()
    });

    // 2. dbt Transformation Models
    packageInfo.dataFlows.forEach(df => {
      const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      
      // Staging model (1-to-1)
      files.dbt.push({
        path: `dbt_project/models/staging/stg_${flowName}.sql`,
        name: `stg_${flowName}.sql`,
        language: 'sql',
        content: generateDbtStagingModel(df, flowName)
      });

      // Intermediate model (joins and logic)
      files.dbt.push({
        path: `dbt_project/models/intermediate/int_${flowName}_joined.sql`,
        name: `int_${flowName}_joined.sql`,
        language: 'sql',
        content: generateDbtIntermediateModel(df, flowName)
      });

      // Mart / Reporting model
      files.dbt.push({
        path: `dbt_project/models/mart/dim_${flowName}.sql`,
        name: `dim_${flowName}.sql`,
        language: 'sql',
        content: generateDbtMartModel(df, flowName)
      });

      // Schema/Test YAML
      files.dbt.push({
        path: `dbt_project/models/staging/schema_${flowName}.yml`,
        name: `schema_${flowName}.yml`,
        language: 'yaml',
        content: generateDbtSchemaYaml(df, flowName)
      });

      // dbt Snapshots (SCD Type 2)
      files.dbt.push({
        path: `dbt_project/snapshots/snp_${flowName}.sql`,
        name: `snp_${flowName}.sql`,
        language: 'sql',
        content: generateDbtSnapshot(df, flowName)
      });

      // Singular/Custom Test for duplicates
      files.dbt.push({
        path: `dbt_project/tests/assert_no_duplicate_${flowName}_per_run_date.sql`,
        name: `assert_no_duplicate_${flowName}_per_run_date.sql`,
        language: 'sql',
        content: generateDbtCustomTest(df, flowName)
      });
    });

    // dbt Macros and Configs
    files.dbt.push({
      path: `dbt_project/macros/generate_surrogate_key.sql`,
      name: 'generate_surrogate_key.sql',
      language: 'sql',
      content: generateDbtMacroKey()
    });
    files.dbt.push({
      path: `dbt_project/dbt_project.yml`,
      name: 'dbt_project.yml',
      language: 'yaml',
      content: generateDbtProjectConfig(pkgName)
    });

    // 3. Airflow DAGs
    files.airflow.push({
      path: `dags/ingestion/${pkgName}_pipeline.py`,
      name: `${pkgName}_pipeline.py`,
      language: 'python',
      content: generateAirflowDag(packageInfo, pkgName)
    });
    files.airflow.push({
      path: `dags/utils/notifications.py`,
      name: 'notifications.py',
      language: 'python',
      content: generateAirflowNotifications()
    });

    // 4. Config & Testing & Reconciliation & CI/CD
    packageInfo.dataFlows.forEach(df => {
      const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      
      // Parallel-Run Reconciliation Script
      files.config.push({
        path: `tests/reconciliation/reconcile_${flowName}.py`,
        name: `reconcile_${flowName}.py`,
        language: 'python',
        content: generateReconciliationScript(df, flowName)
      });

      // Unit tests with mocks
      files.config.push({
        path: `tests/test_extract_${flowName}.py`,
        name: `test_extract_${flowName}.py`,
        language: 'python',
        content: generateUnitTests(df, flowName)
      });
    });

    files.config.push({
      path: `.env.example`,
      name: `.env.example`,
      language: 'properties',
      content: generateEnvExample()
    });
    files.config.push({
      path: `requirements.txt`,
      name: `requirements.txt`,
      language: 'text',
      content: generateRequirementsTxt()
    });
    files.config.push({
      path: `deployment/.gitlab-ci.yml`,
      name: `.gitlab-ci.yml`,
      language: 'yaml',
      content: generateGitLabCi()
    });
    files.config.push({
      path: `README.md`,
      name: `README.md`,
      language: 'markdown',
      content: generateReadme(packageInfo)
    });

    return files;
  }

  /* ── Python Ingestion Generator ────────────────────────────── */
  function generatePythonExtract(df, flowName, packageInfo) {
    const src = df.sources[0] || { name: 'source_table', columns: [], connRef: 'dbo.source_table' };
    const dest = df.destinations[0] || { name: 'dest_table', columns: [], connRef: 'landing.raw_table' };
    const srcTable = src.connRef || 'dbo.source_table';
    const destTable = dest.connRef.split('.').pop() || 'raw_table';
    const destSchema = dest.connRef.includes('.') ? dest.connRef.split('.')[0] : 'landing';

    let selectCols = '*';
    if (src.columns && src.columns.length > 0) {
      selectCols = src.columns.map(c => `            ${c.name}`).join(',\n');
    }

    return `import pyodbc
import pandas as pd
from datetime import date
from ingestion.utils.db import get_connection, get_engine
from ingestion.utils.logger import get_logger
from ingestion.${flowName}.validate_${flowName} import validate_${flowName}

logger = get_logger(__name__)

def extract_${flowName}(run_date: date) -> pd.DataFrame:
    """
    Extract data from source OLTP for the given run date.
    SAFE operation: Only performs SELECT queries.
    """
    conn = get_connection(env="source_oltp")
    query = """
        SELECT
${selectCols}
        FROM ${srcTable}
        WHERE CAST(last_modified_date AS DATE) = ?
    """
    logger.info(f"Extracting ${flowName} data from OLTP for {run_date}...")
    
    # Execute query safely using parameters
    df = pd.read_sql(query, conn, params=[run_date])
    logger.info(f"Successfully extracted {len(df):,} rows from ${srcTable}")
    return df

def load_to_landing(df: pd.DataFrame, run_date: date) -> None:
    """
    Load validated raw DataFrame into SQL Server Landing zone schema.
    Appends metadata columns for full auditing.
    """
    engine = get_engine(env="landing")
    
    # Audit columns
    df["_run_date"] = run_date
    df["_loaded_at"] = pd.Timestamp.utcnow()

    logger.info(f"Writing {len(df):,} records into landing database...")
    df.to_sql(
        name="${destTable}",
        con=engine,
        schema="${destSchema}",
        if_exists="append",  # append daily batch
        index=False,
        chunksize=10000
    )
    logger.info(f"Successfully loaded {len(df):,} rows to ${destSchema}.${destTable}")

if __name__ == "__main__":
    import sys
    run_date_arg = date.today()
    if len(sys.argv) > 1:
        run_date_arg = pd.to_datetime(sys.argv[1]).date()
        
    try:
        # 1. Extract
        df_raw = extract_${flowName}(run_date_arg)
        
        if len(df_raw) > 0:
            # 2. Validate using Pandera rules
            df_validated = validate_${flowName}(df_raw)
            # 3. Load to landing
            load_to_landing(df_validated, run_date_arg)
        else:
            logger.warning("No records extracted to load.")
            
    except Exception as e:
        logger.error(f"Pipeline extraction failed: {str(e)}", exc_info=True)
        sys.exit(1)
`;
  }

  function generatePythonValidate(df, flowName) {
    const src = df.sources[0] || { columns: [] };
    
    let schemaFields = '';
    if (src.columns && src.columns.length > 0) {
      schemaFields = src.columns.map(c => {
        let pType = 'str';
        const uType = c.dataType.toUpperCase();
        if (uType.includes('INT')) pType = 'int';
        else if (uType.includes('DECIMAL') || uType.includes('FLOAT')) pType = 'float';
        else if (uType.includes('BIT') || uType.includes('BOOL')) pType = 'bool';
        else if (uType.includes('DATE') || uType.includes('TIME')) pType = 'pa.DateTime';

        return `    "${c.name}": Column(${pType}, nullable=True),`;
      }).join('\n');
    } else {
      schemaFields = '    # Schema template\n    "id": Column(int, nullable=False),';
    }

    return `import pandera as pa
from pandera import Column, DataFrameSchema, Check

# Strict schema definition to enforce data quality before loading
schema = DataFrameSchema({
${schemaFields}
})

def validate_${flowName}(df):
    """
    Validates DataFrame layout, types and constraints.
    Raises SchemaErrors if validation fails.
    """
    return schema.validate(df, lazy=True)
`;
  }

  function generatePythonDbUtil() {
    return `import os
import pyodbc
from sqlalchemy import create_engine
from ingestion.utils.secrets import get_connection_string

def get_connection(env: str = "prod"):
    """Return raw pyodbc DB connection."""
    conn_str = get_connection_string(env)
    # Extract params for pyodbc raw connection
    return pyodbc.connect(conn_str.replace("mssql+pyodbc://", "DRIVER={ODBC Driver 17 for SQL Server};"))

def get_engine(env: str = "prod"):
    """Return SQLAlchemy engine for Pandas to_sql loads."""
    conn_str = get_connection_string(env)
    return create_engine(conn_str)
`;
  }

  function generatePythonLoggerUtil() {
    return `import logging
import sys

def get_logger(name: str):
    logger = logging.getLogger(name)
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter('[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s')
        
        # StreamHandler
        ch = logging.StreamHandler(sys.stdout)
        ch.setFormatter(formatter)
        logger.addHandler(ch)
    return logger
`;
  }

  function generatePythonSecretsUtil() {
    return `import os
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

_client = None

def get_secret(secret_name: str, vault_url: str) -> str:
    """
    Fetches credentials securely from Azure Key Vault.
    Uses DefaultAzureCredential (supports local CLI login and Managed Identity).
    """
    global _client
    if _client is None:
        credential = DefaultAzureCredential()
        _client = SecretClient(vault_url=vault_url, credential=credential)
    
    secret = _client.get_secret(secret_name)
    return secret.value

def get_connection_string(env: str = "prod") -> str:
    """
    Build connection string dynamically. Falls back to environment variables in dev.
    """
    vault_url = os.getenv("VAULT_URL")
    if vault_url:
        server = get_secret(f"sqlserver-{env}-host", vault_url)
        database = get_secret(f"sqlserver-{env}-database", vault_url)
        username = get_secret(f"sqlserver-{env}-username", vault_url)
        password = get_secret(f"sqlserver-{env}-password", vault_url)
        return f"mssql+pyodbc://{username}:{password}@{server}/{database}?driver=ODBC+Driver+17+for+SQL+Server"
    
    # Fallback env variables (Dev / Local Staging)
    server = os.getenv(f"DB_{env.toUpperCase()}_HOST", "localhost")
    database = os.getenv(f"DB_{env.toUpperCase()}_DATABASE", "DWH")
    username = os.getenv(f"DB_{env.toUpperCase()}_USER")
    password = os.getenv(f"DB_{env.toUpperCase()}_PASSWORD")
    
    if username and password:
        return f"mssql+pyodbc://{username}:{password}@{server}/{database}?driver=ODBC+Driver+17+for+SQL+Server"
    return f"mssql+pyodbc://@{server}/{database}?driver=ODBC+Driver+17+for+SQL+Server;trusted_connection=yes"
`;
  }

  function generatePythonApiClient() {
    return `import requests
from tenacity import retry, stop_after_attempt, wait_exponential
from ingestion.utils.logger import get_logger

logger = get_logger(__name__)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def fetch_from_api(url: str, headers: dict, params: dict = None) -> dict:
    """
    Generic API client with robust retry logic for core-banking and 3rd party APIs.
    """
    logger.info(f"Fetching data from API endpoint: {url}...")
    response = requests.get(url, headers=headers, params=params, timeout=30)
    response.raise_for_status()
    return response.json()
`;
  }

  /* ── dbt Models Generator ──────────────────────────────────── */
  function generateDbtStagingModel(df, flowName) {
    const src = df.sources[0] || { name: 'raw_table', columns: [] };
    const dest = df.destinations[0] || { name: 'raw_table', connRef: 'landing.raw_table' };
    const rawTable = dest.connRef.split('.').pop() || 'raw_table';

    let selectLines = '';
    if (src.columns && src.columns.length > 0) {
      selectLines = src.columns.map(c => {
        let line = `        ${c.name.padEnd(36)} AS ${c.name.toLowerCase()}`;
        if (c.dataType.toUpperCase().includes('BIT')) {
          line = `        CAST(${c.name} AS BIT).padEnd(36) AS ${c.name.toLowerCase()}`;
        }
        return line;
      }).join(',\n');
    } else {
      selectLines = `        *`;
    }

    return `-- models/staging/stg_${flowName}.sql
WITH source AS (
    SELECT * FROM {{ source('landing', '${rawTable}') }}
),

renamed AS (
    SELECT
${selectLines},
        _run_date,
        _loaded_at
    FROM source
)

SELECT * FROM renamed
`;
  }

  function generateDbtIntermediateModel(df, flowName) {
    return `-- models/intermediate/int_${flowName}_joined.sql
WITH staging AS (
    SELECT * FROM {{ ref('stg_${flowName}') }}
)

SELECT
    *,
    -- Example business logic replacing Derived Column / Lookup
    CASE 
        WHEN is_active = 1 THEN 'Active'
        ELSE 'Inactive'
    END AS status_label
FROM staging
`;
  }

  function generateDbtMartModel(df, flowName) {
    return `-- models/mart/dim_${flowName}.sql
WITH intermediate AS (
    SELECT * FROM {{ ref('int_${flowName}_joined') }}
)

SELECT
    -- Final Data Mart Layer
    *
FROM intermediate
`;
  }

  function generateDbtSchemaYaml(df, flowName) {
    const src = df.sources[0] || { columns: [] };
    const pk = src.columns.length > 0 ? src.columns[0].name.toLowerCase() : 'id';

    return `version: 2

models:
  - name: stg_${flowName}
    description: "Staging table for ${flowName}. Initial clean and renaming layer."
    columns:
      - name: ${pk}
        description: "Primary key for ${flowName}"
        tests:
          - not_null
          - unique
`;
  }

  function generateDbtSnapshot(df, flowName) {
    const src = df.sources[0] || { columns: [] };
    const pk = src.columns.length > 0 ? src.columns[0].name.toLowerCase() : 'id';
    
    return `{% snapshot snp_${flowName} %}

{{
    config(
      target_database=var('target_db', 'DWH'),
      target_schema='snapshots',
      unique_key='${pk}',
      strategy='check',
      check_cols=['is_active', 'last_modified_date'],
    )
}}

select * from {{ ref('stg_${flowName}') }}

{% endsnapshot %}
`;
  }

  function generateDbtCustomTest(df, flowName) {
    const src = df.sources[0] || { columns: [] };
    const pk = src.columns.length > 0 ? src.columns[0].name.toLowerCase() : 'id';

    return `-- Custom test: Ensure no duplicates exist for a given run date
SELECT
    ${pk},
    _run_date,
    COUNT(*) AS cnt
FROM {{ ref('stg_${flowName}') }}
GROUP BY ${pk}, _run_date
HAVING COUNT(*) > 1
`;
  }

  function generateDbtMacroKey() {
    return `{% macro generate_surrogate_key(column_names) %}
    CONVERT(VARCHAR(64),
        HASHBYTES('SHA2_256',
            CONCAT_WS('|',
                {% for col in column_names %}
                    CAST(COALESCE({{ col }}, '') AS VARCHAR(MAX))
                    {% if not loop.last %},{% endif %}
                {% endfor %}
            )
        ),
        2
    )
{% endmacro %}
`;
  }

  function generateDbtProjectConfig(pkgName) {
    return `name: '${pkgName}'
version: '1.0.0'
config-version: 2

profile: 'default'

model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["seeds"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]

clean-targets:
  - "target"
  - "dbt_packages"

models:
  ${pkgName}:
    staging:
      +materialized: view
    intermediate:
      +materialized: ephemeral
    mart:
      +materialized: table
`;
  }

  /* ── Airflow DAG Generator ─────────────────────────────────── */
  function generateAirflowDag(packageInfo, pkgName) {
    let taskChains = [];
    let taskDefs = '';

    packageInfo.dataFlows.forEach((df, idx) => {
      const flowName = df.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      
      taskDefs += `    # Task for Data Flow: ${df.name}
    task_extract_${flowName} = BashOperator(
        task_id="extract_${flowName}",
        bash_command="python -m ingestion.${flowName}.extract_${flowName} {{ ds }}",
    )

    task_dbt_run_${flowName} = BashOperator(
        task_id="dbt_run_${flowName}",
        bash_command="cd /opt/dbt && dbt run --select stg_${flowName} dim_${flowName} --profiles-dir /opt/dbt/profiles",
    )

    task_dbt_test_${flowName} = BashOperator(
        task_id="dbt_test_${flowName}",
        bash_command="cd /opt/dbt && dbt test --select stg_${flowName} --profiles-dir /opt/dbt/profiles",
    )
    
`;
      taskChains.push(`task_extract_${flowName} >> task_dbt_run_${flowName} >> task_dbt_test_${flowName}`);
    });

    // Handle SQL Tasks if any
    packageInfo.sqlTasks.forEach(st => {
      const stName = st.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      taskDefs += `    # Execute SQL Legacy Task: ${st.name}
    task_sql_${stName} = BashOperator(
        task_id="sql_${stName}",
        bash_command="dbt run-operation run_legacy_query --args '{query_name: ${stName}}'",
    )
    
`;
    });

    return `from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.bash import BashOperator
from dags.utils.notifications import on_failure_callback

DEFAULT_ARGS = {
    "owner": "data-engineering",
    "depends_on_past": False,
    "start_date": datetime(2026, 1, 1),
    "email": ["data-engineering@bank.co.id"],
    "email_on_failure": True,
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "on_failure_callback": on_failure_callback,
}

with DAG(
    dag_id="${pkgName}_pipeline",
    default_args=DEFAULT_ARGS,
    schedule_interval="0 2 * * *",  # Run daily at 02:00
    catchup=False,
    tags=["ingestion", "${pkgName}", "daily"],
    doc_md="""
    ## SSIS Migrated Pipeline: ${packageInfo.name}
    Auto-generated using SSIS Modernizer.
    
    ### Description:
    ${packageInfo.description || 'No legacy package description provided.'}
    """
) as dag:

    # Trigger completion notification
    task_notify_success = BashOperator(
        task_id="notify_success",
        bash_command="echo 'Pipeline completed successfully!'",
    )

${taskDefs}

    # Pipeline Chain Dependencies
    ${taskChains.join('\n    ')} >> task_notify_success
`;
  }

  function generateAirflowNotifications() {
    return `from airflow.utils.email import send_email

def on_failure_callback(context):
    """
    Sends automated email alerts when a step in the banking pipeline fails.
    """
    dag_id = context["dag"].dag_id
    task_id = context["task_instance"].task_id
    exec_date = context["execution_date"]
    log_url = context["task_instance"].log_url

    subject = f"[CRITICAL FAILURE] Airflow Task Failed: {dag_id} > {task_id}"
    body = f"""
    <h3>Airflow Task Failure Alert</h3>
    <hr/>
    <p><b>DAG ID:</b> {dag_id}</p>
    <p><b>Task ID:</b> {task_id}</p>
    <p><b>Execution Date:</b> {exec_date}</p>
    <p><b>Detailed Log URL:</b> <a href="{log_url}">Open Airflow Log</a></p>
    <hr/>
    <p>Please resolve the issue as it may breach daily SLAs.</p>
    """
    send_email(to=["data-engineering@bank.co.id"], subject=subject, html_content=body)
`;
  }

  /* ── Reconciliation Testing & Unit Mocking Generator ──────── */
  function generateReconciliationScript(df, flowName) {
    const src = df.sources[0] || { columns: [] };
    const pk = src.columns.length > 0 ? src.columns[0].name.toLowerCase() : 'id';

    return `import pandas as pd
from ingestion.utils.db import get_connection

def reconcile_${flowName}(run_date: str) -> dict:
    """
    Validates output results by comparing legacy SSIS output with the modern dbt stack.
    Used during parallel run phases.
    """
    conn = get_connection(env="dwh")

    # 1. Fetch SSIS Output (Legacy target)
    df_ssis = pd.read_sql(f"""
        SELECT ${pk}, is_active
        FROM dbo.dim_${flowName}_ssis
        WHERE load_date = '{run_date}'
    """, conn)

    # 2. Fetch Modern dbt Mart Output
    df_modern = pd.read_sql(f"""
        SELECT ${pk}, is_active
        FROM mart.dim_${flowName}
        WHERE _run_date = '{run_date}'
    """, conn)

    # 3. Perform outer merge to find gaps
    merged = df_ssis.merge(df_modern, on="${pk}", suffixes=("_ssis", "_modern"), how="outer", indicator=True)

    result = {
        "total_ssis": len(df_ssis),
        "total_modern": len(df_modern),
        "only_in_ssis": len(merged[merged["_merge"] == "left_only"]),
        "only_in_modern": len(merged[merged["_merge"] == "right_only"]),
        "mismatches": len(merged[merged["is_active_ssis"] != merged["is_active_modern"]]),
    }
    return result

if __name__ == "__main__":
    import sys
    date_str = sys.argv[1] if len(sys.argv) > 1 else "2026-06-15"
    res = reconcile_${flowName}(date_str)
    print("Reconciliation Summary:", res)
`;
  }

  function generateUnitTests(df, flowName) {
    const src = df.sources[0] || { columns: [] };
    const pk = src.columns.length > 0 ? src.columns[0].name.toLowerCase() : 'id';

    return `import pytest
import pandas as pd
from unittest.mock import MagicMock, patch
from datetime import date
import pandera.errors

from ingestion.${flowName}.extract_${flowName} import extract_${flowName}
from ingestion.${flowName}.validate_${flowName} import validate_${flowName}

@pytest.fixture
def mock_raw_df():
    return pd.DataFrame({
        "${pk}": [1, 2, 3],
        "is_active": [True, True, False],
        "last_modified_date": pd.to_datetime(["2026-06-15"] * 3)
    })

def test_validate_${flowName}_success(mock_raw_df):
    result = validate_${flowName}(mock_raw_df)
    assert len(result) == 3

def test_validate_${flowName}_failures(mock_raw_df):
    # Null primary key test
    mock_raw_df.loc[0, "${pk}"] = None
    with pytest.raises(pandera.errors.SchemaErrors):
        validate_${flowName}(mock_raw_df)

@patch("ingestion.${flowName}.extract_${flowName}.get_connection")
@patch("ingestion.${flowName}.extract_${flowName}.pd.read_sql")
def test_extract_${flowName}_db_query(mock_read_sql, mock_get_conn, mock_raw_df):
    mock_read_sql.return_value = mock_raw_df
    res = extract_${flowName}(date(2026, 6, 15))
    assert len(res) == 3
    mock_read_sql.assert_called_once()
`;
  }

  /* ── Extra Config & Requirements Generator ─────────────────── */
  function generateEnvExample() {
    return `# Secrets Management Vault URL
VAULT_URL=https://your-bank-vault.vault.azure.net/

# Dynamic configurations
ENVIRONMENT=dev

# DB Credentials (fallback for local development only)
DB_SOURCE_OLTP_HOST=oltp-sqlserver.bank.internal
DB_SOURCE_OLTP_DATABASE=OperationalDB
DB_SOURCE_OLTP_USER=de_etl_user
DB_SOURCE_OLTP_PASSWORD=secure_password_here

DB_LANDING_HOST=dwh-sqlserver.bank.internal
DB_LANDING_DATABASE=DWH_Landing
DB_LANDING_USER=de_load_user
DB_LANDING_PASSWORD=secure_password_here

# Airflow configurations
AIRFLOW_FERNET_KEY=
DBT_PROFILES_DIR=/opt/dbt/profiles
`;
  }

  function generateRequirementsTxt() {
    return `pandas>=2.0.0
pyodbc>=4.0.39
sqlalchemy>=2.0.0
pandera>=0.15.0
pytest>=7.0.0
dbt-sqlserver>=1.5.0
apache-airflow>=2.6.0
azure-identity>=1.12.0
azure-keyvault-secrets>=4.7.0
tenacity>=8.2.0
`;
  }

  function generateGitLabCi() {
    return `stages:
  - lint
  - test
  - deploy

lint-python:
  stage: lint
  image: python:3.11-slim
  script:
    - pip install ruff
    - ruff check ingestion/ dags/

dbt-compile:
  stage: test
  image: python:3.11-slim
  script:
    - pip install dbt-sqlserver
    - dbt deps
    - dbt compile

deploy-staging:
  stage: deploy
  script:
    - echo "Deploying pipeline definitions to staging Airflow server..."
    - cp dags/ingestion/*.py /opt/airflow/dags/
  only:
    - main
`;
  }

  function generateReadme(packageInfo) {
    return `# Modernized SSIS Project: ${packageInfo.name}

This project is an automated, code-based modernization of the legacy SSIS package **${packageInfo.name}**.

## Stack Architecture
* **Ingestion Layer:** Python (\`pyodbc\` + \`pandas\` + \`pandera\` schema validation)
* **Transformation Layer:** dbt (SQL Server adapter)
* **Orchestration Layer:** Apache Airflow DAG

## Directory Layout
* \`dags/\` — Airflow pipeline definition.
* \`ingestion/\` — Python raw extraction scripts.
* \`dbt_project/\` — SQL staging, intermediate, and mart models.
* \`tests/\` — Pytest unit tests.
`;
  }

  return { generate };
})();
