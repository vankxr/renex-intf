const HTTPS = require("https");

const desired_origin = "LISBOA SETE RIOS";
const desired_destination = "LEIRIA";
const desired_date = new Date(2020, 3 - 1, 20, 20, 00);
const desired_seat = 30;

var origins = [];

////////////////////////////////////////////////
function gen_browser_token()
{
    var result = "";
    var characters = "abcdef0123456789";

    for(var i = 0; i < 32; i++)
    {
        result += characters.charAt(Math.floor(Math.random() * characters.length));

        if(i == 7 || i == 11 || i == 15 || i == 19)
            result += "-";
    }

    return result;
}
function is_seat_free(map, seat)
{
    for(var i = 0; i < map.length; i++)
    {
        if(seat >= map[i].first && seat <= map[i].last)
            return true;
    }

    return false;
}

function keep_seat_reserved(browser_token, schedule, passenger, seat)
{
    console.log("Creating reservation for schedule '" + schedule.schedule_id + "'...");

    create_reservation(
        browser_token,
        schedule,
        null,
        passenger,
        function (e, reservation_token)
        {
            if(e)
                return console.error(e);

            if(!reservation_token)
                return console.error("Malformated response");

            console.log("Created reservation!");
            console.log("Getting reservation details...");

            get_reservation_details(
                browser_token,
                reservation_token,
                function (e, reservation_details)
                {
                    if(e)
                        return console.error(e);

                    //console.log(require("util").inspect(reservation_details, {showHidden: false, depth: null}))

                    var reservation_id = reservation_details.reservationId;

                    console.log("Reservation ID: " + reservation_id);
                    console.log("Getting seat details...");

                    function check_reservation()
                    {
                        get_seat_list(
                            browser_token,
                            reservation_id,
                            function (e, seat_details)
                            {
                                if(e)
                                    return console.error(e);

                                //console.log(require("util").inspect(seat_details, {showHidden: false, depth: null}))

                                if(!seat_details.outgoing_itinerary ||
                                   !seat_details.outgoing_itinerary.legs ||
                                   !seat_details.outgoing_itinerary.legs.length ||
                                   !seat_details.outgoing_itinerary.legs[0].available_seats ||
                                   !seat_details.outgoing_itinerary.legs[0].assigned_seats ||
                                   !seat_details.outgoing_itinerary.legs[0].assigned_seats.length)
                                {
                                    console.log("Expired reservation!");

                                    return keep_seat_reserved(gen_browser_token(), schedule, passenger, seat);
                                }

                                var seat_map = seat_details.outgoing_itinerary.legs[0].available_seats;
                                var current_seat = seat_details.outgoing_itinerary.legs[0].assigned_seats[0].seat_no;

                                console.log("Got current seat: " + current_seat);

                                if(current_seat != seat)
                                {
                                    if(!is_seat_free(seat_map, seat))
                                    {
                                        console.log("Desired seat is not free!");
                                    }
                                    else
                                    {
                                        console.log("Changing current seat " + current_seat + " to " + seat);

                                        change_seat(
                                            browser_token,
                                            reservation_id,
                                            1,
                                            null,
                                            current_seat,
                                            seat,
                                            function (e, seat_details)
                                            {
                                                if(e)
                                                    return console.error(e);

                                                //console.log(require("util").inspect(seat_details, {showHidden: false, depth: null}))
                                            }
                                        );
                                    }
                                }

                                setTimeout(check_reservation, 2000);
                            }
                        );
                    }

                    check_reservation();
                }
            );
        }
    );
}

function fetch_origins(browser_token, national, international, callback)
{
    var payload = {
        national: national,
        international: international
    };

    var req_body = JSON.stringify(payload);
    var req_options = {
        host: "www.rede-expressos.pt",
        port: "443",
        path: "/api/locations/origins",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    var req = HTTPS.request(
        req_options,
        function (response)
        {
            response.body = [];

            response.on('data',
                function(chunk)
                {
                    response.body.push(chunk);
                }
            );

            response.on('end',
                function()
                {
                    if(response.statusCode != 200)
                        return callback("Request unsuccessfull (" + response.statusCode + ")");

                    response.body = Buffer.concat(response.body);

                    if(!response.body)
                        return callback("Invalid body");

                    try
                    {
                        response.body = JSON.parse(response.body);
                    }
                    catch (e)
                    {
                        return callback(e);
                    }

                    return callback(null, response.body);
                }
            );
        }
    )

    req.on("error", callback);
    req.write(req_body);
    req.end();
}
function fetch_destinations(browser_token, origin_id, national, international, callback)
{
    var payload = {
        national: national,
        international: international,
        originId: origin_id.toString()
    };

    var req_body = JSON.stringify(payload);
    var req_options = {
        host: "www.rede-expressos.pt",
        port: "443",
        path: "/api/locations/destinations",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    var req = HTTPS.request(
        req_options,
        function (response)
        {
            response.body = [];

            response.on('data',
                function(chunk)
                {
                    response.body.push(chunk);
                }
            );

            response.on('end',
                function()
                {
                    if(response.statusCode != 200)
                        return callback("Request unsuccessfull (" + response.statusCode + ")");

                    response.body = Buffer.concat(response.body);

                    if(!response.body)
                        return callback("Invalid body");

                    try
                    {
                        response.body = JSON.parse(response.body);
                    }
                    catch (e)
                    {
                        return callback(e);
                    }

                    return callback(null, response.body);
                }
            );
        }
    )

    req.on("error", callback);
    req.write(req_body);
    req.end();
}
function fetch_ticket_schedules(browser_token, rflex_id, origin_id, destination_id, outgoing_date, passengers, callback)
{
    var payload = {
        rflexNr: rflex_id > 0 ? rflex_id.toString : "",
        jsonInput: {
            idOrigin: origin_id.toString(),
            idDestination: destination_id.toString(),
            dateIda: outgoing_date.toISOString(),
            passengerList: passengers.length ? passengers : [passengers]
        },
        refresh: true
    };

    var req_body = JSON.stringify(payload);
    var req_options = {
        host: "www.rede-expressos.pt",
        port: "443",
        path: "/api/ticketing/getTickets",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    var req = HTTPS.request(
        req_options,
        function (response)
        {
            response.body = [];

            response.on('data',
                function(chunk)
                {
                    response.body.push(chunk);
                }
            );

            response.on('end',
                function()
                {
                    if(response.statusCode != 200)
                        return callback("Request unsuccessfull (" + response.statusCode + ")");

                    response.body = Buffer.concat(response.body);

                    if(!response.body)
                        return callback("Invalid body");

                    try
                    {
                        response.body = JSON.parse(response.body);
                    }
                    catch (e)
                    {
                        return callback(e);
                    }

                    return callback(null, response.body);
                }
            );
        }
    )

    req.on("error", callback);
    req.write(req_body);
    req.end();
}
function create_reservation(browser_token, outgoing_schedule, return_schedule, passengers, callback)
{
    var payload = {
        jsonInput: {
            outgoing_schedule: outgoing_schedule.schedule_id.toString(),
            outgoing_date: outgoing_schedule.departure_date.toISOString(),
            return_schedule: return_schedule ? return_schedule.schedule_id.toString() : null,
            return_date: return_schedule ? return_schedule.departure_date.toISOString() : null,
            passengers: passengers.length ? passengers : [passengers]
        },
        recover: null
    };

    var req_body = JSON.stringify(payload);
    var req_options = {
        host: "www.rede-expressos.pt",
        port: "443",
        path: "/api/reservation/create",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    var req = HTTPS.request(
        req_options,
        function (response)
        {
            response.body = [];

            response.on('data',
                function(chunk)
                {
                    response.body.push(chunk);
                }
            );

            response.on('end',
                function()
                {
                    if(response.statusCode != 200)
                        return callback("Request unsuccessfull (" + response.statusCode + ")");

                    response.body = Buffer.concat(response.body);

                    if(!response.body)
                        return callback("Invalid body");

                    response.body = response.body.toString("utf8"); // Response is plain text, some kind of token (looks like base64 but decoding yields garbage)
                    response.body = response.body.substr(1, response.body.length - 2); // Remove quotes at the start and end

                    return callback(null, response.body);
                }
            );
        }
    )

    req.on("error", callback);
    req.write(req_body);
    req.end();
}
function get_reservation_details(browser_token, reservation_token, callback)
{
    var payload = {
        Id: reservation_token
    };

    var req_body = JSON.stringify(payload);
    var req_options = {
        host: "www.rede-expressos.pt",
        port: "443",
        path: "/api/reservation/details",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    var req = HTTPS.request(
        req_options,
        function (response)
        {
            response.body = [];

            response.on('data',
                function(chunk)
                {
                    response.body.push(chunk);
                }
            );

            response.on('end',
                function()
                {
                    if(response.statusCode != 200)
                        return callback("Request unsuccessfull (" + response.statusCode + ")");

                    response.body = Buffer.concat(response.body);

                    if(!response.body)
                        return callback("Invalid body");

                    try
                    {
                        response.body = JSON.parse(response.body);
                    }
                    catch (e)
                    {
                        return callback(e);
                    }

                    return callback(null, response.body);
                }
            );
        }
    )

    req.on("error", callback);
    req.write(req_body);
    req.end();
}
function get_seat_list(browser_token, reservation_id, callback)
{
    var payload = {
        reservationId: reservation_id
    };

    var req_body = JSON.stringify(payload);
    var req_options = {
        host: "www.rede-expressos.pt",
        port: "443",
        path: "/api/ticketing_new/seats/list",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    var req = HTTPS.request(
        req_options,
        function (response)
        {
            response.body = [];

            response.on('data',
                function(chunk)
                {
                    response.body.push(chunk);
                }
            );

            response.on('end',
                function()
                {
                    if(response.statusCode != 200)
                        return callback("Request unsuccessfull (" + response.statusCode + ")");

                    response.body = Buffer.concat(response.body);

                    if(!response.body)
                        return callback("Invalid body");

                    try
                    {
                        response.body = JSON.parse(response.body);
                    }
                    catch (e)
                    {
                        return callback(e);
                    }

                    return callback(null, response.body);
                }
            );
        }
    )

    req.on("error", callback);
    req.write(req_body);
    req.end();
}
function change_seat(browser_token, reservation_id, outgoing_leg, return_leg, current_seat, new_seat, callback)
{
    var payload = {
        reservationNr: reservation_id,
        jsonInput: []
    };

    current_seat = current_seat.length ? current_seat : [current_seat];
    new_seat = new_seat.length ? new_seat : [new_seat];

    for(var i = 0; i < current_seat.length; i++)
    {
        payload.jsonInput[i] = {
            outgoing_leg_no: outgoing_leg, // Trip branch (if there is need to switch buses)
            return_leg_no: return_leg,
            current_seat_no: current_seat[i],
            new_seat_no: new_seat[i],
            passenger_id: i + 1
        }
    }

    var req_body = JSON.stringify(payload);
    var req_options = {
        host: "www.rede-expressos.pt",
        port: "443",
        path: "/api/ticketing_new/seats/change",
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": req_body.length,
            "Browser-Lang": "pt",
            "Browser-Token": browser_token
        }
    };

    var req = HTTPS.request(
        req_options,
        function (response)
        {
            response.body = [];

            response.on('data',
                function(chunk)
                {
                    response.body.push(chunk);
                }
            );

            response.on('end',
                function()
                {
                    if(response.statusCode != 200)
                        return callback("Request unsuccessfull (" + response.statusCode + ")");

                    response.body = Buffer.concat(response.body);

                    if(!response.body)
                        return callback("Invalid body");

                    try
                    {
                        response.body = JSON.parse(response.body);
                    }
                    catch (e)
                    {
                        return callback(e);
                    }

                    return callback(null, response.body);
                }
            );
        }
    )

    req.on("error", callback);
    req.write(req_body);
    req.end();
}
////////////////////////////////////////////////

var browser_token = gen_browser_token();

console.log("Fetching origins...");

fetch_origins(
    browser_token,
    true,
    false,
    function (e, fetched_origins)
    {
        if(e)
            return console.error(e);

        console.log("Fetched " + fetched_origins.length + " origins!");

        var desired_origin_id = 0;

        for(var i = 0; i < fetched_origins.length; i++)
        {
            //console.log(fetched_origins[i].id + " - " + fetched_origins[i].name);

            origins[i] = {
                id: parseInt(fetched_origins[i].id),
                name: fetched_origins[i].name
            };

            if(fetched_origins[i].name == desired_origin)
            {
                console.log("Found origin '" + desired_origin + "'. ID: " + fetched_origins[i].id);

                desired_origin_id = parseInt(fetched_origins[i].id);
            }
        }

        console.log("Fetching destinations for '" + desired_origin + "'...");

        fetch_destinations(
            browser_token,
            desired_origin_id,
            true,
            false,
            function (e, fetched_destinations)
            {
                if(e)
                    return console.error(e);

                console.log("Fetched " + fetched_destinations.length + " destinations!");

                var desired_destination_id = 0;

                for(var i = 0; i < fetched_destinations.length; i++)
                {
                    //console.log(fetched_destinations[i].id + " - " + fetched_destinations[i].name);

                    if(fetched_destinations[i].name == desired_destination)
                    {
                        console.log("Found destination '" + desired_destination + "'. ID: " + fetched_destinations[i].id);

                        desired_destination_id = parseInt(fetched_destinations[i].id);

                        break;
                    }
                }

                console.log("Fetching ticket schedules for '" + desired_origin + "' > '" + desired_destination + "' on " + desired_date.toString() + "...");

                var passenger = {
                    fare_type_id: 1,
                    name: "",
                    email: "",
                    doc: "",
                    promocode: "", // RFLEX ID
                    id: "1"
                };

                fetch_ticket_schedules(
                    browser_token,
                    null,
                    desired_origin_id,
                    desired_destination_id,
                    desired_date,
                    passenger,
                    function (e, fetched_schedules)
                    {
                        if(e)
                            return console.error(e);

                        if(!fetched_schedules.length || !fetched_schedules[0] || !fetched_schedules[0].outgoing_schedules)
                            return console.error("Malformated response");

                        fetched_schedules = fetched_schedules[0].outgoing_schedules;

                        console.log("Fetched " + fetched_schedules.length + " schedules!");

                        var desired_schedule = undefined;
                        var min_schedule_difference = Date.now();

                        for(var i = 0; i < fetched_schedules.length; i++)
                        {
                            //console.log(require("util").inspect(fetched_schedules[i], {showHidden: false, depth: null}))

                            fetched_schedules[i].departure_date = new Date(
                                parseInt(fetched_schedules[i].date.substr(0, 4)),
                                parseInt(fetched_schedules[i].date.substr(5, 2)) - 1,
                                parseInt(fetched_schedules[i].date.substr(8, 2)),
                                parseInt(fetched_schedules[i].departure_time.substr(0, 2)),
                                parseInt(fetched_schedules[i].departure_time.substr(3, 2))
                            );

                            fetched_schedules[i].arrival_date = new Date(
                                parseInt(fetched_schedules[i].date.substr(0, 4)),
                                parseInt(fetched_schedules[i].date.substr(5, 2)) - 1,
                                parseInt(fetched_schedules[i].date.substr(8, 2)),
                                parseInt(fetched_schedules[i].arrival_time.substr(0, 2)),
                                parseInt(fetched_schedules[i].arrival_time.substr(3, 2))
                            );

                            var schedule_difference = Math.abs(desired_date.getTime() - fetched_schedules[i].departure_date.getTime());

                            if(schedule_difference < min_schedule_difference)
                            {
                                min_schedule_difference = schedule_difference;

                                desired_schedule = fetched_schedules[i];
                            }
                        }

                        console.log("Found schedule departing on " + desired_schedule.departure_date.toString() + " and arriving on " + desired_schedule.arrival_date.toString() + ". ID: " + desired_schedule.schedule_id);

                        keep_seat_reserved(browser_token, desired_schedule, passenger, desired_seat);
                    }
                );
            }
        );
    }
);