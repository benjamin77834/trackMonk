import json
import boto3
import requests
import pymysql
import base64

def lambda_handler(event, context):
    print("Event:", json.dumps(event))
    
    company_id = event.get('company_id')
    plan = event.get('plan', 'basic')
    email = event.get('email', '')
    
    plans = {
        'basic': {'amount': 1999.00, 'name': 'TrackMonk Básico - 5 dispositivos'},
        'pro': {'amount': 3299.00, 'name': 'TrackMonk Pro - 20 dispositivos'},
        'enterprise': {'amount': 4999.00, 'name': 'TrackMonk Enterprise - Ilimitado'},
    }
    
    if plan not in plans:
        return {'statusCode': 400, 'body': json.dumps({'error': 'Plan inválido'})}
    
    plan_info = plans[plan]
    
    # Conectar a BD para registrar el intento de pago
    conn = pymysql.connect(
        host='18.234.77.182',
        user='operador',
        password='operador01',
        database='trackmonk_v2'
    )
    
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO payments (company_id, plan, amount, status) VALUES (%s, %s, %s, 'pending')",
            (company_id, plan, plan_info['amount'])
        )
        conn.commit()
        payment_id = cur.lastrowid
    
    # Obtener API key de Clip desde Secrets Manager
    sm = boto3.client('secretsmanager')
    secret = json.loads(sm.get_secret_value(SecretId='clip')['SecretString'])
    clip_key = secret['clip']
    
    # Crear link de pago con Clip
    success_url = f"https://tracker.monkeyfon.com/pago-exitoso.html?id={payment_id}"
    error_url = "https://tracker.monkeyfon.com/planes.html"
    
    payload = {
        "amount": plan_info['amount'],
        "currency": "MXN",
        "purchase_description": plan_info['name'],
        "redirection_url": {
            "success": success_url,
            "error": error_url,
            "default": error_url
        },
        "metadata": {
            "me_reference_id": str(payment_id),
            "customer_info": {
                "name": str(company_id),
                "email": email,
                "phone": 0
            }
        },
        "webhook_url": "https://api-tracker.monkeyfon.com/api/payment-webhook"
    }
    
    headers = {
        "accept": "application/vnd.com.payclip.v2+json",
        "content-Type": "application/json",
        "x-api-key": "Basic " + clip_key
    }
    
    response = requests.post("https://api-gw.payclip.com/checkout", json=payload, headers=headers)
    print("Clip response:", response.status_code, response.text)
    
    if response.status_code == 200:
        clip_data = response.json()
        payment_request_id = clip_data.get('payment_request_id', '')
        payment_url = clip_data.get('payment_url', '')
        
        # Actualizar BD con el ID de Clip
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE payments SET clip_id=%s, status='created' WHERE id=%s",
                (payment_request_id, payment_id)
            )
            conn.commit()
        
        conn.close()
        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'payment_id': payment_id,
                'payment_url': payment_url,
                'payment_request_id': payment_request_id
            })
        }
    else:
        conn.close()
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Error creando pago en Clip', 'detail': response.text})
        }
