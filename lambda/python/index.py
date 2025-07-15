# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json
import os
import boto3
from datetime import datetime
from boto3.dynamodb.conditions import Key, Attr
from botocore.exceptions import ClientError

# Get environment variables
customers_table_name = os.environ.get("CUSTOMERS_TABLE")
tradesperson_table_name = os.environ.get("TRADESPERSON_TABLE")
bookings_table_name = os.environ.get("BOOKINGS_TABLE")

# Initialize DynamoDB resources
dynamodb = boto3.resource("dynamodb")
customers_table = dynamodb.Table(customers_table_name)
tradesperson_table = dynamodb.Table(tradesperson_table_name)
bookings_table = dynamodb.Table(bookings_table_name)


def handler(event, context):
    """
    Main handler for the plumbing assistant Lambda function
    This single Lambda handles all operations for the Bedrock agent
    """
    print(f"Event received: {json.dumps(event, default=str)}")

    try:
        # Extract the API operation from the event
        api_path = event.get("apiPath")

        # Get customerId from session attributes if available
        customer_id = event.get("sessionAttributes", {}).get("phone-number", "00000")

        # Initialize response variables
        response_body = {}
        http_status_code = 200

        # Handle POST requests with request bodies
        post_parameters = []
        if event.get("requestBody") and event["requestBody"].get("content", {}).get(
            "application/json", {}
        ).get("properties"):
            post_parameters = event["requestBody"]["content"]["application/json"][
                "properties"
            ]

        post_params = {prop["name"]: prop["value"] for prop in post_parameters}

        print(f"Processing {api_path} operation")

        additional_prompt_session_attributes = {}

        # Route to the appropriate handler based on the operation
        if api_path == "/get-current-datetime":
            response_body = get_current_date_time()
            http_status_code = response_body.get("statusCode", 200)
        elif api_path == "/get-customer-details":
            response_body = get_customer_details(customer_id)
            http_status_code = response_body.get("statusCode", 200)
            if http_status_code == 200 and response_body["body"]["customer"]:
                additional_prompt_session_attributes["customerName"] = response_body[
                    "body"
                ]["customer"]["name"]
                additional_prompt_session_attributes["customerCity"] = response_body[
                    "body"
                ]["customer"]["city"]
        elif api_path == "/register-customer":
            response_body = register_customer(customer_id, post_params)
            additional_prompt_session_attributes["customerName"] = response_body[
                "body"
            ]["name"]
            additional_prompt_session_attributes["customerCity"] = response_body[
                "body"
            ]["city"]
            http_status_code = response_body.get("statusCode", 200)
        elif api_path == "/search-trades-persons":
            response_body = search_trades_persons(post_params)
            http_status_code = response_body.get("statusCode", 200)
        elif api_path == "/check-availability":
            response_body = check_availability(post_params)
            http_status_code = response_body.get("statusCode", 200)
        elif api_path == "/create-booking":
            response_body = create_booking(customer_id, post_params)
            http_status_code = response_body.get("statusCode", 200)
        elif api_path == "/get-latest-booking":
            response_body = get_latest_booking(customer_id)
            http_status_code = response_body.get("statusCode", 200)
        elif api_path == "/cancel-booking":
            response_body = cancel_booking(post_params)
            http_status_code = response_body.get("statusCode", 200)
        elif api_path == "/update-booking":
            response_body = update_booking(customer_id, post_params)
            http_status_code = response_body.get("statusCode", 200)
        else:
            response_body = {"error": f"Unsupported operation: {api_path}"}
            http_status_code = 400
        # Format the response according to the provided example
        response_body_formatted = {
            "application/json": {"body": response_body.get("body", response_body)}
        }

        action_response = {
            "actionGroup": event.get("actionGroup"),
            "apiPath": event.get("apiPath"),
            "httpMethod": event.get("httpMethod"),
            "httpStatusCode": http_status_code,
            "responseBody": response_body_formatted,
        }

        session_attributes = event.get("sessionAttributes", {})

        prompt_session_attributes = event.get("promptSessionAttributes", {})

        prompt_session_attributes.update({"customerId": customer_id})
        prompt_session_attributes.update({"customerPhoneNumber": customer_id})
        prompt_session_attributes.update(additional_prompt_session_attributes)

        api_response = {
            "messageVersion": "1.0",
            "response": action_response,
            "sessionAttributes": session_attributes,
            "promptSessionAttributes": prompt_session_attributes,
        }

        return api_response

    except Exception as e:
        print(f"Error processing request: {str(e)}")

        response_body_formatted = {
            "application/json": {"body": {"error": "Internal server error"}}
        }

        action_response = {
            "actionGroup": event.get("actionGroup"),
            "apiPath": event.get("apiPath"),
            "httpMethod": event.get("httpMethod"),
            "httpStatusCode": 500,
            "responseBody": response_body_formatted,
        }

        session_attributes = event.get("sessionAttributes", {})
        prompt_session_attributes = event.get("promptSessionAttributes", {})

        api_response = {
            "messageVersion": "1.0",
            "response": action_response,
            "sessionAttributes": session_attributes,
            "promptSessionAttributes": prompt_session_attributes,
        }

        return api_response


def search_trades_persons(params):
    """
    Search for tradespeople based on trade, location, and rating
    """
    trade = params.get("trade")
    city = params.get("city")

    # Query DynamoDB using the TradeIndex GSI
    response = tradesperson_table.query(
        IndexName="TradeIndex",
        KeyConditionExpression=Key("trade").eq(trade.lower())
        & Key("city").eq(city.lower()),
    )

    # Format the response
    trades_persons = [
        {
            "tradesPersonId": item.get("tradesPersonId"),
            "name": item.get("name"),
            "trade": item.get("trade"),
            "hourlyRate": item.get("hourlyRate"),
            "city": item.get("city"),
            "contactNumber": item.get("contactNumber"),
        }
        for item in response.get("Items", [])
    ]

    return {
        "statusCode": 200,
        "body": {"tradesPersons": trades_persons, "count": len(trades_persons)},
    }


def check_availability(params):
    """
    Check availability for a specific date and time
    """
    tradesperson_id = params.get("tradesPersonId")
    start_slot = params.get("startSlot")
    end_slot = params.get("endSlot")

    start_hour = datetime.fromisoformat(start_slot.replace("Z", "+00:00")).hour
    end_hour = datetime.fromisoformat(end_slot.replace("Z", "+00:00")).hour

    # Query DynamoDB for existing bookings in the time range
    response = bookings_table.query(
        IndexName="TradesPersonIdIndex",
        KeyConditionExpression=Key("tradesPersonId").eq(tradesperson_id)
        & Key("slot").between(start_slot, end_slot),
    )

    booked_slots = [item.get("slot") for item in response.get("Items", [])]

    # Generate available time slots
    available_time_slots = []
    for i in range(start_hour, end_hour):
        temp_date = datetime.fromisoformat(start_slot.replace("Z", "+00:00"))
        temp_date = temp_date.replace(hour=i)
        slot = temp_date.isoformat()
        if slot not in booked_slots:
            available_time_slots.append(slot)

    return {"statusCode": 200, "body": {"availableTimeSlots": available_time_slots}}


def create_booking(customer_id, params):
    """
    Create a new booking
    """
    tradesperson_id = params.get("tradesPersonId")
    slot = params.get("slot")
    description = params.get("description")

    # Generate a booking ID
    booking_id = "b" + str(int(datetime.now().timestamp()))[-5:]

    # Create the booking
    booking = {
        "bookingId": booking_id,
        "tradesPersonId": tradesperson_id,
        "customerId": customer_id,
        "slot": datetime.fromisoformat(slot.replace("Z", "+00:00")).isoformat(),
        "description": description,
    }

    # Save the booking to DynamoDB
    bookings_table.put_item(Item=booking)

    # Get tradesperson details to include in the confirmation
    tradesperson_response = tradesperson_table.get_item(
        Key={"tradesPersonId": tradesperson_id}
    )
    tradesperson_details = tradesperson_response.get("Item", {})

    return {
        "statusCode": 200,
        "body": {
            "message": "Booking created successfully",
            "bookingId": booking_id,
            "tradesPersonName": tradesperson_details.get("name", "Unknown"),
            "slot": slot,
            "description": description,
        },
    }


def register_customer(customer_id, params):
    """
    Register a new customer
    """
    name = params.get("name")
    city = params.get("city")

    customers_table.put_item(
        Item={"customerId": customer_id, "name": name, "city": city}
    )

    return {
        "statusCode": 200,
        "body": {
            "message": "Customer registered successfully",
            "name": name,
            "city": city,
        },
    }


def get_customer_details(customer_id):
    """
    Get customer details by ID
    """
    response = customers_table.get_item(Key={"customerId": customer_id})

    if "Item" not in response:
        return {"statusCode": 404, "body": {"error": "Customer not found"}}

    return {"statusCode": 200, "body": {"customer": response["Item"]}}


def get_latest_booking(customer_id):
    """
    Get the latest booking for a customer
    """
    response = bookings_table.query(
        IndexName="CustomerIdIndex",
        KeyConditionExpression=Key("customerId").eq(customer_id),
    )

    if not response.get("Items"):
        return {
            "statusCode": 404,
            "body": {"error": "No bookings found for this customer"},
        }

    item = response["Items"][0]

    # Get tradesperson details for the booking
    tradesperson_response = tradesperson_table.get_item(
        Key={"tradesPersonId": item.get("tradesPersonId")}
    )
    tradesperson_details = tradesperson_response.get("Item", {})

    # Format the date for better readability
    booking_date = datetime.fromisoformat(
        item.get("slot").replace("Z", "+00:00")
    ).strftime("%Y-%m-%d %H:%M:%S")

    enhanced_booking = {
        "bookingId": item.get("bookingId"),
        "tradesPersonName": tradesperson_details.get("name", "Unknown"),
        "tradesPersonTrade": tradesperson_details.get("trade", "Unknown"),
        "bookingDateTime": booking_date,
        "description": item.get("description"),
    }

    return {"statusCode": 200, "body": {"booking": enhanced_booking}}


def cancel_booking(params):
    """
    Cancel an existing booking
    """
    booking_id = params.get("bookingId")

    # Get the existing booking first to return its details
    booking_response = bookings_table.get_item(Key={"bookingId": booking_id})

    if "Item" not in booking_response:
        return {"statusCode": 404, "body": {"error": "Booking not found"}}

    booking = booking_response["Item"]

    # Get tradesperson details
    tradesperson_response = tradesperson_table.get_item(
        Key={"tradesPersonId": booking.get("tradesPersonId")}
    )
    tradesperson_details = tradesperson_response.get("Item", {})

    # Delete the booking
    bookings_table.delete_item(Key={"bookingId": booking_id})

    return {
        "statusCode": 200,
        "body": {
            "message": "Booking cancelled successfully",
            **booking,
            **tradesperson_details,
            "status": "CANCELLED",
        },
    }


def update_booking(customer_id, params):
    """
    Update an existing booking with a new time slot
    """
    booking_id = params.get("bookingId")
    slot = params.get("slot")

    # Get the existing booking first to verify it exists and belongs to the customer
    booking_response = bookings_table.get_item(Key={"bookingId": booking_id})

    if "Item" not in booking_response:
        return {"statusCode": 404, "body": {"error": "Booking not found"}}

    booking = booking_response["Item"]

    # Verify the booking belongs to the customer
    if booking.get("customerId") != customer_id:
        return {
            "statusCode": 403,
            "body": {"error": "Not authorized to update this booking"},
        }

    # Update the booking with the new slot
    new_slot = datetime.fromisoformat(slot.replace("Z", "+00:00")).isoformat()

    bookings_table.update_item(
        Key={"bookingId": booking_id},
        UpdateExpression="set slot = :slot",
        ExpressionAttributeValues={":slot": new_slot},
        ReturnValues="ALL_NEW",
    )

    # Get tradesperson details to include in the confirmation
    tradesperson_response = tradesperson_table.get_item(
        Key={"tradesPersonId": booking.get("tradesPersonId")}
    )
    tradesperson_details = tradesperson_response.get("Item", {})

    return {
        "statusCode": 200,
        "body": {
            "message": "Booking updated successfully",
            "bookingId": booking_id,
            "tradesPersonName": tradesperson_details.get("name", "Unknown"),
            "oldSlot": booking.get("slot"),
            "newSlot": new_slot,
            "description": booking.get("description"),
        },
    }


def get_current_date_time():
    """
    Get the current date and time to help with relative date calculations
    """
    now = datetime.now()

    # Format the date in a human-readable format
    formatted_date = now.strftime("%A, %B %d, %Y, %I:%M:%S %p %Z")

    return {
        "statusCode": 200,
        "body": {
            "currentDateTime": str(now),
            "currentDateTimeISO": now.isoformat(),
            "currentTimestamp": int(now.timestamp()),
            "formattedDate": formatted_date,
        },
    }
