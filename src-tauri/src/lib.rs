use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::Manager;

#[derive(Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Value>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    ok: bool,
    body: Value,
}

#[tauri::command]
async fn http_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let method = request
        .method
        .parse::<reqwest::Method>()
        .map_err(|e| format!("invalid method: {e}"))?;

    let client = reqwest::Client::new();
    let mut builder = client.request(method, &request.url);

    if let Some(headers) = request.headers {
        let mut header_map = reqwest::header::HeaderMap::new();
        for (key, value) in headers {
            let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                .map_err(|e| format!("invalid header name {key}: {e}"))?;
            let header_value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|e| format!("invalid header value for {key}: {e}"))?;
            header_map.insert(name, header_value);
        }
        builder = builder.headers(header_map);
    }

    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("failed to read response body: {e}"))?;

    let json_body: Value = serde_json::from_slice(&bytes).unwrap_or_else(|_| {
        Value::String(String::from_utf8_lossy(&bytes).into_owned())
    });

    Ok(HttpResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        body: json_body,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![http_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
